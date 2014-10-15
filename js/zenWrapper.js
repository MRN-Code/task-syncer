var PouchDB = require('pouchdb'),
    Promise = require('rsvp').Promise,
    jsondiff = require('jsondiffpatch').create({
      // used to match objects when diffing arrays, by default only === operator is used
      objectHash: function(obj) {return obj._id || obj.id; },
      arrays: {detectMove: false, includeValueOnMove: false },
      textDiff: {minLength: 60}
    }),
    zendesk = require('node-zendesk');

/**
 * provides zen specific functionality for the sync app
 * @param {Object} config - json formatted configurat data
 */
function ZenWrapper(config) {
    this.clientConnectData = config;
    this.now = (new Date()).getTime();
    this.pollingInterval = 31556900; // fallback, 1 year in s
    this.client = {};
    this.dbconfig = {};
    this.dbC = {};
    this.dbI = {};
    this.dbTools = {};
    this.dbs = {};
    this.duplicateTickets=[];
    this.items = {};
    this.lastUpdate = 0;
    this.logger = {};
    this.map = [];
    this.newTickets=[];
    this.updatedTickets=[];
}



/**
 * initialzes per a parent syncer's provided configuration
 * @param  {Object} config - json configurations
 * @return {Promise} - initialization complete
 */
ZenWrapper.prototype.init = function(config) {
    var _this = this;
    return new Promise(function(resolve, reject) {
        _this.client = zendesk.createClient(_this.clientConnectData);

        _this.logger = config.common.logger;
        _this.map = config.common.map;
        _this.dbTools = config.common.dbtools;

        _this.pollingInterval = config.common.pollingInterval;

        //link databases
        _this.dbconfig = config.common.dbconfig.db;
        _this.dbC = config.dbC.db;
        _this.dbI = config.dbI.db;
        _this.dbs[config.common.dbconfig.name] = config.common.dbconfig.name;
        _this.dbs[config.dbC.name] = config.dbC.db;
        _this.dbs[config.dbI.name] = config.dbI.db;

        resolve(_this);
    });
};



/**
 * Fetches new zen tickets, then categorizes them into new, updated, duplicate
 * @return {Promise} fetch complete
 * TODO: abstract into syncer, but keep service specific remote fetch
 */
ZenWrapper.prototype.fetch = function () {
    var _this = this;
    return new Promise(function fetchP(resolve, reject) {
        // Retrieve time that we last refreshed
        _this.dbconfig.get('lastZenUpdate')
            .catch(function fetchlastUpdateTimeF(error){
                _this.setLastUpdateTime(0).then(function initTime(response) { //attempt to generate db set time
                    _this.logger.warn('::: Restart the application to try again.  This is likely first boot or DB purged!');
                    reject(error); //must reject to start reinit
                    return;
                }, reject);
            })
            .then(function fetchlastUpdateTimeS(response){
                return _this.getTickets(response);
            }) //get tickets, add them to dB, update lastUpdated time
            .then(function fetchGetTicketsS(items){
                return _this.sort(items);
            })
            .then(function fetchSortS(){
                _this.logger.info("(fetch) unprocessed tickets: " +
                _this.newTickets.length + "\n\t(fetch) updated tickets: " +
                _this.updatedTickets.length + "\n\t(fetch) duplicate tickets: " +
                _this.duplicateTickets.length);
                resolve(true);
            })
            .catch(reject);
  });
};



/**
 * class attr:value getter
 * @param  {string} key - wrapper member name
 * @return {*}
 */
ZenWrapper.prototype.get = function(key) {
  switch(key){
    case 'updated':
      return this.updatedTickets;
    case 'new':
      return this.newTickets;
    case 'service':
      return this.client;
    default:
      return null;
  }
};



/**
 * fetches a single full ticket
 * @param  {Object} shortTicket - object with a zen id as
 *   {id:ticket number}
 * @param  {Number=} tScalar - optional number to space out single
 *   ticket requests
 * @param  {Array=} fullTickets - optional array to push result to
 * @return {Promise} - resolves to the full ticket
 */
ZenWrapper.prototype.getFullTicket = function(shortTicket, tScalar, fullTickets){
  var _this = this;
  tScalar = tScalar || 1;
  fullTickets = fullTickets || [];
  return new Promise(function getFullTicketP(resolve, reject){
    setTimeout(function(){
      _this.client.tickets.show(shortTicket.id,
        function getFullTicketCB(err, statusList, body, responseList, resultList) {
          if (err) {
            if (err.statusCode == 404) {
              resolve(404);
              return;
            } else {
              throw err;
            }
          }
          if (body.id) {
            fullTickets.push(body);
            resolve(body);
          } else {
            reject(body);
        }
      });
    }, 600*tScalar);
  });
};



/**
 * remote call to zen to fetch tickets.  sub-function of 'fetch'
 * http://developer.zendesk.com/documentation/rest_api/tickets.html
 * @param  {Number}   sinceTime - time since last update/fetch was successful
 * @param  {Function} cb
 * @return {Promise}
 * TODO:
 */
ZenWrapper.prototype.getTickets = function(sinceTime, cb) {
    var _this = this,
        ticketExport = true, // determines which method to execute to get tickets - true in production, false in dev
        timeoutDur = 10000,
        ticketsFetched = false;
    if (sinceTime.time >= 0) {
        //update earlier than we claimed to have last updated from as a failsafe
        sinceTime = Math.floor(sinceTime.time/1000)-_this.pollingInterval*300;
        if(sinceTime < 0) sinceTime = 0;
    } else {
        throw new Error("db last update time wasn't configured properly");
    }
    _this.logger.info("Zen tickets last updated @: " +
        (new Date(sinceTime*1000)).toISOString() +
        ' (epoch:' + Math.floor(sinceTime/1000) + ')');
    _this.logger.info("Fetching zen tickets (SLOW)");

  return new Promise(function(resolve, reject) {
    //output mode 1 - output recent items only
    if (ticketExport) {
      _this.client.tickets.export(sinceTime,
        function getTicketsExportCB(err, statusList, body, responseList, resultList) {
        if (err || !body) {
          reject(err || new Error("ZenDesk API rendered a bogus response"));
          return;
        }

        if (!body.hasOwnProperty('results') || body.results.length === 0) {
          resolve();
          return;
        }

        process.stdout.write(" (new/updated ticket IDs) ");
        // _this.dbTools.writeFile(JSON.stringify(body,null,2),'updatedTickets.log');

        //results do not have descripition, thus, we must fetch the unique ticket to get the description
        var shortTickets = [],
            fullTicketPs = [],
            fullTickets = [];
        if (body.results) shortTickets = body.results;

        //map all of the short tickets to promises of receipt of full tickets
        fullTicketPs = shortTickets.map(function getFullTicketPs(el,ndx,a){
          return _this.getFullTicket(el, ndx + 1, fullTickets)
            .then(function logTicket(ticket){
              if (ticket && ticket.hasOwnProperty('id')) process.stdout.write(ticket.id + ", ");
              else process.stdout.write("(deletedTik), ");
            });
        });

        //all full tickets fetched or failed to fetch
        Promise.all(fullTicketPs)
          .then(function allFullTicketsFetchS(r){
            ticketsFetched = true;
            process.stdout.write('success (' + fullTickets.length + ')\n\n');
            resolve(fullTickets); // use when using tickets.export vs tickets.list
          })
          .catch(function allFullTicketsFetchF(r){
            throw new Error('Full tickets fetch failed');
          });
      });
    } else { //output mode 2 - output all items
      _this.client.tickets.list(function (err, statusList, body, responseList, resultList) {
        if (err) {
          reject(err);
          return;
        }
        ticketsFetched = true;
        process.stdout.write('success (' + body.length + ')');
        resolve(body); // use when  tickets.list vs tickets.export
      });
    }
  });
};




/**
 * Returns an object from a service to a generic, flat object, & lossy object,
 * OR, returns a service specific object from a generic
 * @param  {Object} src - input object
 * @param  {Boolean} generic - determines type of object to be output
 * @param  {Boolean} partial - permits a non-full object
 * @return {Object}  service specific or generic json encoded object
 */
ZenWrapper.prototype.mapItem = function(src, generic, partial) {
  var _this = this, newObj = {};
  _this.map.forEach(function objectMapper(elementProp, ndx, arry) { //build newObj object from map
    try{
      switch (elementProp.toString()) {
        case 'id':
          newObj.id = src.id;
          break;
        case 'assignee_id':
        //   newObj.assignee_id = src.assignee_id;
          break;
        case 'complete':
            if (generic) {
              newObj.complete = (src.status.match(/closed/i) ||
                src.status.match(/solved/i)) ? 'true' : 'false';
            } else {
              newObj.status = (src.complete) ? 'closed' : 'open';
            }
          break;
        case 'description':
          newObj.description = src.description +
            "\n\nhttps://coins.zendesk.com/agent/#/tickets/" + src.id;
          break;
        case 'subject':
          if (generic) newObj.title = src.subject;
          else newObj.subject = src.subject;
          break;
        case 'title':
          if (generic) newObj.title = src.subject;
          else newObj.subject = src.title;
          break;
        default:
          if (partial) break;
          throw new Error("ZenWrapper could not map a property of a 'ticket' " +
            "to " + prop);
      }
    } catch(e) {
      throw e;
    }
  });
  return newObj;
};



/**
 * pushes item to local storage db(s)
 * @param  {Object} item - doc to store in db
 * @return {Promise}
 */
ZenWrapper.prototype.pushLocal = function(item) {
  _this = this;
  return new Promise(function pushItemP(resolve,reject) {
    var itemGeneric = _this.mapItem(item, true);
    if (itemGeneric.complete === 'true') {
        _this.dbTools.pouchSet(_this.dbC,itemGeneric.id,item)
          .then(resolve, reject);
    } else {
        _this.dbTools.pouchSet(_this.dbI,itemGeneric.id,item)
          .then(resolve,reject);
    }
  });
};



/**
 * updates the config db with the time that zen items were last updated
 * @param {Number} timeVal - ~current time
 * TODO: abstract this task to be within syncer
 */
ZenWrapper.prototype.setLastUpdateTime = function(timeVal) {
  if(timeVal !== 0 && !timeVal) timeVal = this.now; //if no args
  return this.dbTools.pouchSet(this.dbconfig,
                              'lastZenUpdate',
                              {time: Math.floor(timeVal/1000)*1000});
};


/**
 * sets new, updated, and duplicate tickets
 * wipes prior values.  intended to be used post fetch
 * @param  {Array} bulkItems - array of raw service tickets
 * @return {Promise}
 */
ZenWrapper.prototype.sort = function(bulkItems) {
  var _this = this,
      sortedPromises = [],
      diff,
      genericItem,
      genericDBItem;
  return new Promise(function sortP(resolve,reject) {
    _this.duplicateTickets = [];
    _this.newTickets = [];
    try{
      sortedPromises = bulkItems.map(function(item,ndx,arry){
        // if item already exists, add to duplicates, else new ticket
        return new Promise(function sortSingleP(resolve, reject){
          _this.itemExists(item)
            .then(function itemExistsS(dbitem) {
              if (dbitem) {
                genericItem = _this.mapItem(item,true);
                genericDBItem = _this.mapItem(dbitem, true);
                diff = jsondiff.diff(genericItem, genericDBItem);
                if (diff) {
                  diff = JSON.parse(JSON.stringify(diff));
                  _this.updatedTickets.push(item);
                } else _this.duplicateTickets.push(item);
              } else _this.newTickets.push(item);
              resolve(dbitem);
            })
            .catch(reject);
        });
      });
    } catch(e){
      throw e;
    }

    //all items sorted
    Promise.all(sortedPromises)
      .then(function sortedPsS(responses){
        resolve(responses);
      })
      .catch(function sortedPsF(responses){
        reject(responses);
      });
  });
};



/**
 * determines if an item exists locally or not
 * @param  {Object} ticket - item to test for existence
 * @return {Promise}
 * TODO: abstract up to syncer, change language to item, not ticket
 */
ZenWrapper.prototype.itemExists = function(ticket) {
  var ticketID = ticket.id, pfulfilled = false;
  _this = this;
  return new Promise(function itemExistsP(resolve,reject) {
    var isIncomplete = _this.dbI.get(ticketID.toString())
      .then(function isIncompleteS(response) {
        resolve(response);
        return response;
      })
      .catch(function isIncompleteF(error) {
        return false;
      });
    var isComplete = _this.dbC.get(ticketID.toString())
      .then(function isCompleteS(response) {
        resolve(response);
        return response;
      })
      .catch(function isCompleteF(error) {
        return false;
      });
    setTimeout(function() {
        if (!pfulfilled) reject(new Error("(itemExists) timed out" + 2000/1000 + " seconds"));
    }, 3000);

    //both dbs queried
    Promise.all([isIncomplete, isComplete])
      .then(function itemExistAllS(results){ //if both promises resolve to false, resolve to false (no tickets found!).  Otherwise, promise has already resolved
        pfulfilled = true;
        if(!results[0] && !results[1]) resolve(false);
      });
  });
};

// export the class
module.exports = ZenWrapper;
