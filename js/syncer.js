var fs = require('fs'),
  CronJob = require('cron').CronJob,
  DBExtend = require('./dbextend.js'),
  PouchDB = require('pouchdb'),
  Promise = require('rsvp').Promise,
  staticConfig = require('./syncConfig.js'),
  winston = require('winston');

var dbextender = new DBExtend();



/**
 * constructor
 * @param {string} rootDir, required for log & db locations
 */
function Syncer(){
    this.serverRoot = process.cwd();
    this._construct(staticConfig);
    this.ready = this.init(); // Bind ready promise to init
}



/**
 * private constructor for managing syncing between two services
 * @param {Object} config
 {
    dbs: { // name the database types per your service
        config: 'arbtirary-config-name',
        syncs: 'service1-service2-syncs',
        service1Complete: 'zen-complete',
        service1Incomplete: 'zen-incomplete',
        service2Complete: 'asana-complete',
        service2Incomplete: 'asana-incomplete'
    },
    pollingInterval: seconds, //the syncer redundantly checks
    // the active interval and the previous to ensure all data is captured
    // if there is a remote server error
    service1: {
        service: zen, //service1 wrapper object
        name: 'zen' //
    },
    service2: {
        service: asana,
        name: 'asana'
    },
    bindService1to2: true,
    bindService2to1: false,
    fieldmap: ['description','complete','title','id'] // items that must be common
}
 */
Syncer.prototype._construct = function(config) {
    this.allSyncs = []; // lightweight array of all sync objects
    this.dbdir = './db/';
    this.dbs = {};
    this.dbTypes = config.dbs; // {type: {name: str, db: dbObj} } referenced by GUI
    this.dbTools = dbextender;
    this.pollingInterval = config.pollingInterval;
    this.logger = config.logger;
    this.service1 = config.service1.service;
    this.service1name = config.service1.name || '';
    this.service2 = config.service2.service;
    this.service2name = config.service2.name || '';
    this.bind1 = config.bindService1to2;
    this.bind2 = config.bindService2to1;
    this.map = config.fieldmap;
    this.syncLock = false;
    this.syncLockDur = 60; // seconds, minimum before another sync can happen
    this.warnings = {
        allSyncsEmpty: {
            message: "WARNING: no syncs found.  If this is first boot, disregard",
            emitted: 0
        }
    };
};



/**
 * Gets updates from services and stores them in mem (not in db) for processing
 */
Syncer.prototype.fetchAll = function(){
  var _this = this;
  return new Promise(function fetchAllP(resolve,reject){
    _this.logger.info("Fetching latest %s and %s data",
      _this.service1name,
      _this.service2name);
    var promise1 = _this.service1.fetch(),
        promise2 = _this.service2.fetch();

    promise1.catch(function service1FetchFail(e){
        if (e && e.message) {
            _this.logger.warn(e.message);
        } else if (typeof e === "object") {
            _this.logger.warn("Service 1 fetch fail: " + JSON.stringify(e));
        }
        _this.logger.warn(":: Retry to fetch srv 1 in 3 seconds...");
        setTimeout(function fetchAllRetry(){
            var promise1_2nd = _this.service1.fetch();
            Promise.all([promise1_2nd, promise2]).then(function fetchSecondAttemptCB(rs) {
                resolve();
            })
            .catch(function fetchSecondAttemptCBFail(e){
                if (e && e.message) {
                    _this.logger.error(e.message);
                } else if (typeof e === 'object') {
                    _this.logger.error(JSON.stringify(e));
                } else {
                    _this.logger.error("Failed second fetch attempt.  No failure data available");
                }
                reject(e);
            });
        },3000);
    });

    Promise.all([promise1,promise2]).then(resolve); // don't reject if p1 fails
    promise2.catch(reject); // TODO: promise 2 is currently a dummy!
  });
};



/*
 * initializes the syncer
 */
Syncer.prototype.init = function(webroot) {
    var _this = this,
        commonResources, service1promise, service2promise;

    //auto-sync cron
    _this.cron = new CronJob('*/5 * * * *', function AZSync(){
        _this.sync();
    }, null, true, null);

    _this.logger = new (winston.Logger)({
        transports: [
            new (winston.transports.Console)({
                level: 'debug',
                colorize: true
            }),
            new (winston.transports.File)({
                level: 'warn',
                filename: _this.serverRoot + '/log/sync.log',
                timestamp: true,
                maxsize: 5243000,
                maxFiles: 5
            })
        ]
    });

    // Bring up databases, services, bind service object wrappers to Syncer
    if (_this.initDBs()) {
        if (_this.service1name) _this[_this.service1name] = _this.service1;
        if (_this.service2name) _this[_this.service2name] = _this.service2;
        commonResources = {
            map: _this.map,
            dbconfig: _this.dbs.config,
            dbtools: _this.dbTools,
            pollingInterval: _this.pollingInterval,
            logger: _this.logger
        };
        service1promise = this.service1.init({
            common: commonResources,
            dbC: _this.dbs.service1Complete,
            dbI: _this.dbs.service1Incomplete
        });
        service2promise = this.service2.init({
            common: commonResources,
            dbC: _this.dbs.service2Complete,
            dbI: _this.dbs.service2Incomplete
        });

        return Promise.all([service2promise, service2promise])
            .then(function(responses){ /*do something*/ })
            .catch(function(error){
                _this.logger.error("(fatal) cannot initialize!", error);
                throw error;
            });
      } else {
        throw new Error("Databases could not be initialized");
    }
};


/**
 * initializes the database input strings and loads them into the syncer as such:
 * _this.dbs = {
 *   config: {
 *     db = database object
 *     name = "db-name-as-provided"
 *   },
 *   syncs: {...}
 *   ...
 * }
 * @return {Boolean}
 */
Syncer.prototype.initDBs = function() {
  var _this = this, dir = _this.dbdir, newDBObj = {};
  try {
    for (var dbType in _this.dbTypes) {
      _this.logger.verbose("Initializing db: %s (%s)", _this.dbTypes[dbType], dbType);
      _this.dbs[dbType] = {
        name: _this.dbTypes[dbType],
        db: new PouchDB(dir + _this.dbTypes[dbType]) //create a db using the name first in the array
      };
    }
  } catch(error){
    throw error;
  }
  return true;
};



/**
 * turns of the auto-sycning cron job
 */
Syncer.prototype.disableAutoSync = function() {
  var _this = this;
  _this.cron.stop();
};



/**
 * Loads all syncs into memory
 * @return {Promise}
 */
Syncer.prototype.loadLocalSyncs = function() {
    var _this = this;
    return new Promise(function loadAllSyncsToMem(resolve, reject){
        _this.dbs.syncs.db.allDocs({include_docs: true}, function(err,response){
            if (err) {
                _this.logger.error(err.message);
                reject(err);
            }
            if (response && response.rows) {
                _this.allSyncs = response.rows;
                resolve(response.rows);
            }
            reject({error: "db returned no err or data"});
        });
    });
};



/**
 * adds new sync object.  contains id of one item from a service,
 * generates a new id from the other service, and stores them both
 * in a new object with additional properties
 * @param  {Array of JSON objects} newService1Items [description]
 * @param  {Array of JSON objects} newService2Items [description]
 * @return {[type]}                  [description]
 */
Syncer.prototype.newSyncs = function(newService1Items, newService2Items){
  var _this = this,
      firstSuccess = true,
      syncCompletePromises;
  return new Promise(function(resolve,reject){
    if(!newService1Items && !newService2Items) throw Error("No service items were specified to be added to Syncer");
    if(newService1Items && newService2Items) throw new Error("New syncs can take only one list of new service items!");
    if(newService1Items){

      //Generate new times for service 1
      if (newService1Items.length) {
        _this.logger.info("Generating %d new sync items...", newService1Items.length);
      }

      //Process each item slated for adding
      syncCompletePromises = newService1Items.map(function newSyncsAllS(srv1item, ndx, arry){
        return new Promise(function syncSingle(resolve, reject){
          var generic1;
          try{
            generic1 = _this.service1.mapItem(srv1item, true);

            //Check if item hasn't already been synced
            existingSync = _this.syncExists(generic1.id,null);
            if (existingSync) {
              resolve(false);
              return;
            }
          } catch (e) {
            _this.logger.error('Unsuccessful generic-map or existence test for new item', e);
          }

          //Item hasn't been sync'd - create and store item 2
          try{
            _this.service2.newItem(generic1)
                //then zip 1&2 items together, write sync & 1 locally
                .then(function generateNewSync(srv2item){
                  var generic2 = _this.service2.mapItem(srv2item, true),
                      newSync = {
                        id1: generic1.id,
                        id2: generic2.id,
                        title: generic1.title,
                        complete: (generic1.complete==='true' ? 'true' : 'false')
                      };
                  //output successful additions to screen
                  if (firstSuccess) {
                    process.stdout.write("New " + _this.service2name +
                      " items added remotely & locally.  IDs: " + generic2.id);
                    firstSuccess = false;
                  } else if (ndx !== arry.length-1) process.stdout.write(srv2item.id + ", ");
                  else _this.logger.info(srv2item.id);

                  //store item 1, store sync
                  _this.service1.pushLocal(srv1item)
                    .then(function StoreSyncS(dbresponse){
                      _this.dbs.syncs.db.put(newSync,newSync.id1 + "-" + newSync.id2)
                        .then(resolve, reject); //resolve this sync promise in the array
                    }, reject);
                })
                .catch(function newItemF(e){
                  _this.logger.error('Unable to add new sync!' + e.message, JSON.stringify(e,null,2));
                  throw e;
                });
          } catch(e) {
            _this.logger.error('Unable to add new sync!', e);
            throw e;
          }
        });
      });

      //all new items added successfully
      Promise.all(syncCompletePromises).then(function AllSyncSuccess(promisesArr){
        _this.logger.info("(newSyncs) " + _this.service1name + " and " +
          _this.service2name + " items synced locally and remotely");
        resolve(promisesArr);
      }, reject);
    }
  });
};



/**
 * processes all data fetched to temporary memory
 */
Syncer.prototype.process = function(){
  var _this = this;
  return new Promise(function(resolve,reject){
    if (_this.bind1 && _this.bind2) { //perform syncing tasks one service, then the other.  Not the case in zen-asana case
    } else if(_this.bind1) { //perform syncing tasks from service1 to service 2
      _this.logger.info("Processing new items on service binding: " + _this.service1name +
        " to " + _this.service2name);
      //Process new issues from service 1
      var pnew = _this.processNew(true, null);

      //Process changed items from service 1
      var pchanged = _this.processChanged(true, null);

      Promise.all([pnew, pchanged])
        .then(function processingComplete(){
          _this.service1.setLastUpdateTime();
          resolve();
        })
        .catch(reject);

    } else if (_this.bind2){
    } else {
    }
  });
};



/**
 * processes updated items
 * @param  {Boolean} serv1 - process service 1 updates
 * @param  {Boolean} serv2 - process service 2 updates
 * @return {Promise}
 */
Syncer.prototype.processChanged = function(serv1, serv2) {
  var _this = this;

  return new Promise(function processChangedP(resolve,reject) {
    if (serv1) {
      // Prepare list of changed service 1 items to update in service2 remote+locally
      var updatedServ1Items = _this.service1.get('updated');
      if (!updatedServ1Items.length) {
        _this.logger.info("(processChanged) [serv1] (0)");
        resolve(false);
        return;
      }

      // For each srv1 update, gen new srv2 item to overwrite with
      updatedServ1Items = updatedServ1Items.map(function(srv1item,ndx,arry) {
        return new Promise(function updatedServ1ItemsP(resolve,reject){
          var srv1Generic = _this.service1.mapItem(srv1item,true),
              updatedService2Item = _this.service2.mapItem(srv1Generic, null, true),
              existingSync = _this.syncExists(srv1Generic.id, null);
              newSync = JSON.parse(JSON.stringify(existingSync));

          //get id number of existing service2 task, create the task, update it
          newSync.title = srv1Generic.title; //generic may have updated title

          _this.service2.updateItem(updatedService2Item, existingSync.id2)

            //service 2 update success.  Update service 1. remote & local
            .then(function deleteLocalService1(updatedService2TaskFromWeb){
              return _this.dbTools.deleteFromAll([_this.dbs.service1Complete.db,
                                          _this.dbs.service1Incomplete.db],
                                          srv1Generic.id);
            })
            .then(function pushLocalService1(purgedPromises){
              return _this.service1.pushLocal(srv1item);
            })
            .then(function pushLocalSyncUpdated(dbresponse){
              if(newSync.title === existingSync.title) return existingSync;
              _this.dbs.syncs.db.put(newSync,newSync.id1 + "-" + newSync.id2)
                  .then(resolve, reject); //resolve this sync promise in the array
             })
            .then(resolve, reject);
          });
      });

      //all changed items updated
      Promise.all(updatedServ1Items)
        .then(resolve,reject);
    } else throw new Error('TODO: Processing service 2 incomplete');
  });
};



/**
 * processes new items
 * @param  {Boolean} serv1 - process service 1 updates
 * @param  {Boolean} serv2 - process service 2 updates
 * @return {Promise}
 */
Syncer.prototype.processNew = function(serv1, serv2) {
  var _this = this,
      newIDs = [];
  return new Promise(function processNewP(resolve,reject) {
    if (serv1) {
      var newItems = _this.service1.get('new');
      if (!newItems.length) {
        _this.logger.info("(processNew) [serv1] (0)");
        resolve(false);
        return;
      }
      //generate new syncs for all local service 1 items
      for (var itm in newItems) {
        newIDs.push(newItems[itm].id);
      }
      _this.logger.debug("New items to process: ", newIDs);
      _this.newSyncs(newItems, null)
        .then(function newItemSuccess(promiseArr){
          _this.logger.info("(processNew) [serv1] (%d)", newItems.length);
          resolve(promiseArr);
        })
        .catch(reject);
    } else throw new Error('TODO: Processing service 2 incomplete');
  });
};



/**
 * initiates the syncing process - top level begin function
 * @return {Promise}
 */
Syncer.prototype.sync = function(){
  var _this = this,
      notLocked;
    return _this.loadLocalSyncs().then(function syncContd(){
        notLocked = _this.syncLocker();
        if (!notLocked) {
            return Promise .reject(new Error('(sync) Locked out of syncing!  Please wait"'));
        }
        _this.logger.info("(sync) begin");
        return _this.fetchAll()
            .then(function syncFetched(response){
                _this.process()
                    .then(function proccessS(r){
                    _this.logger.info("(sync) complete.");
                    _this.terminate();
                    return;
                    }
                )
                .catch(function processF(err){
                    _this.logger.error("(sync) failed :(", err.stack);
                    return;
                    }
                );
            })
            .catch(function syncFail(errors){
                _this.logger.log("(fatal) See errors below:");
                _this.logger.dir(errors);
                }
            );
    });
};



/**
 * determines if sync object exists in mem. CAUTION: does not update after
 * additional syncs added
 * @param  {String} id1
 * @param  {String} id2
 * @return {sync|Boolean}
 */
Syncer.prototype.syncExists = function(id1,id2) {
  var _this = this, currID, currSync;
  if(!_this.allSyncs.length && !_this.warnings.allSyncsEmpty.emitted){
    _this.logger.warn(_this.warnings.allSyncsEmpty.message);
    _this.warnings.allSyncsEmpty.emitted++;
  }
  if(!id1 && !id2) throw new Error("(syncExists) No id specified");
  for(var i = 0; i < _this.allSyncs.length; i++){
    currSync = _this.allSyncs[i];
    if(id1 && !id2){
      //extract ID1 from first half of ###-####
      currID = currSync.id.match(/^[0-9]{1,10}/)[0];
      if (id1 == currID) return currSync.doc;
    } else if(!id1 && id2){
      //extract ID1 from first half of ###-####
      currID = currSync.id.match(/[^\-][0-9]*$/)[0];
      if (id2 == currID) return currSync.doc;
    } else{
      if (currSync.id == (id1 + '-' + id2)) return currSync.doc;
    }
  }
  return false;
};



/**
 * checks & locks the ability to sync
 * @return {Boolean} true = ok to sync
 */
Syncer.prototype.syncLocker = function(){
  var _this = this;
  if(_this.syncLock) return false;
  _this.syncLock = true;
  setTimeout(function unlockSyncing(){
      _this.syncLock = false;
  },_this.syncLockDur*1000);
  return true;
};



/**
 * clears memory from the sync
 */
Syncer.prototype.terminate = function(){
  this.allSyncs = [];
};

//Node-ize
module.exports = Syncer;
