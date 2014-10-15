/*jslint node: true */
var asanaClient = require('./lib/asana-api/lib/asana.js'),
  fs = require('fs'),
  PouchDB = require('pouchdb'),
  Promise = require('rsvp').Promise;

/**
 * provides asana specific functionality for the sync app
 * @param {Object} config - json formatted configurat data
 */
function AsanaWrapper(config) {
  this.client = asanaClient;
  this.apiKey = config.apiKey;
  this.workspace = config.workspace;
  this.projects = config.projects;
  this.dbconfig = {};
  this.dbC = {};
  this.dbI = {};
  this.dbTools = {};
  this.lastUpdate = 0;
  this.logger = {};
  this.map = [];
  this.users = 0;
}



/**
 * initializes the asana wrapper
 * @param  {Object} config
 * @return {Promise} Promise
 */
AsanaWrapper.prototype.init = function(config) {
  var _this = this;
  return new Promise(function(resolve, reject) {
    try{
      _this.client.setApiKey(_this.apiKey);
      //refence field mapping
      _this.map = config.common.map;

      //link databases
      _this.dbconfig = config.common.dbconfig.db;
      _this.logger = config.common.logger;
      _this.dbC = config.dbC.db;
      _this.dbI = config.dbI.db;

      //bonus DB functions
      _this.dbTools = config.common.dbtools;
      resolve(_this);
    } catch(error){
      reject(error);
      return;
    }
  });
};



AsanaWrapper.prototype.clientCall = function(funcName,funcArgsArr) {
  var _this = this;
  return new Promise(function clientCallP(resolve, reject){
    var cb = function(err,data){
      if (err) {
        reject(err);
        return;
      }
      resolve(data);
    };
    funcArgsArr = funcArgsArr.concat([cb]);
    _this.client[funcName](funcArgsArr);
  });
};



/**
 * deletes a task from the open and closed dbs as applicable
 * @param  {Number|string} id - task id
 * @return {Promise}
 */
AsanaWrapper.prototype.deleteLocalTask = function(id){
  var _this = this;
  return new Promise(function(resolve, reject){
    _this.dbTools.deleteFromAll([_this.dbC,_this.dbI], id)
      .then(resolve,reject);
  });
};



/**
 * fetches new asana tickets, then categorizes them into new, updated, duplicate
 * @return {Promise} fetch complete
 * TODO: abstract into syncer, but keep service specific remote fetch
 * TODO: generate asana fetch remote and fetch remote 'updated' once req'd
 */
AsanaWrapper.prototype.fetch = function () {
  return Promise.resolve();
};



/**
 * class attr:value getter
 * @param  {string} key - wrapper member name
 * @return {*}
 */
AsanaWrapper.prototype.get = function(key) {
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
 * Returns an object from a service to a generic, flat object, & lossy object,
 * OR, returns a service specific object from a generic
 * @param  {Object} src - input object
 * @param  {Boolean} genericOut - determines type of object to be output
 * @param  {Boolean} partial - permits a non-full object
 * @return {Object}  service specific or generic json encoded object
 */
AsanaWrapper.prototype.mapItem = function(src, genericOut, partial) {
  var _this = this, newObj = {}, prop = '';
  if(!_this.map.length) throw new Error("Task map is missing or corrupt.  Cannot generate Asana task from generic!");
  try{
    _this.map.forEach(function mapEachProp(prop,ndx,arry) { //build item, ensure all map elements present
      switch (prop) {
        case 'id':
          newObj.id = src.id || null;
          break;
        case 'assignee_id':
        //   //asana to generic
        //   if (genericOut) newObj.assignee = {}; //src.assignee.id;
        //   //generic to asana
        //   else {
        //     newObj.assignee = {};
        //     newObj.assignee.id = null;
        //   }
        //   //TODO: match names from serivce to service, then insert paired ID
          break;
        case 'complete': //asana native
          if (genericOut) {
            newObj.complete = src.completed;
          } else {
            newObj.completed = src.complete;
          }
          break;
        case 'title':
          if (genericOut) newObj.title = src.name;
          else newObj.name = src.title;
          break;
        case 'description':
          if (genericOut) newObj.description = src.notes;
          else newObj.notes = src.description;
          break;
        default:
          if (partial) break;
          _this.logger.error("(mapItem) Unable to map item!  Please inspect the function and the map!");
          throw new Error("AsanaWrapper could not map a property of a 'task'" +
            " to " + prop);
      }
    });
  } catch(e) {
      throw e;
  }
  return newObj;
};



/**
 * generates new item, pushes new or update to local and remote
 * @param  {Object} taskGeneric - generic json object
 * @return {Promise}
 */
AsanaWrapper.prototype.newItem = function(taskGeneric){
  var _this = this;
   return new Promise(function newItemP(resolve, reject){
    //build object
    _this.logger.verbose("Adding " + taskGeneric.id + " remotely, then to " +
      (taskGeneric.complete === 'true' ? 'dbC' : 'dbI'));

    var newTask = _this.mapItem(taskGeneric),
        destDb = (taskGeneric.complete === 'true' ? _this.dbC : _this.dbI);


    if (!taskGeneric.hasOwnProperty('id')){
      reject(new Error("No new asana task could be added.  " +
        "Passed *empty* generic task!"));
      return;
    }

    //new tasks must be added to specified project spaces
    newTask.projects = _this.projects;

    //push local and web asana tasks
    _this.pushTaskRemote(newTask)
      .then(function AsanaPushRemoteS(asanaTask){
        return _this.pushTaskLocal(asanaTask, destDb);
      })
      .then(resolve,reject);
  });
};



/**
 * pushes asana task to asana
 * @param  {Object} createTaskObj - json object of fields that asana
 *   api requires
 * @return {Promsise}
 */
AsanaWrapper.prototype.pushTaskRemote = function(createTaskObj) {
  var _this = this;
  return new Promise(function pushTaskRemoteP(resolve,reject) {
    _this.logger.verbose("(pushTaskRemote) adding " + createTaskObj.id);
    _this.client.createWorkspaceTask(_this.workspace, createTaskObj, function(error, response){
      if (error) {
        _this.logger.error('(AsanaWrapper - pushTask) Could not push task to Asana!');
        reject(error);
        return;
      }
      //{errors:[{message:'assignee:No email, ID, or "me": [object Object]'}]}
      if (response.hasOwnProperty('error') ||
          response.hasOwnProperty('errors')) {
        reject(response);
        return;
      } else resolve(response.data); //return the new ticket from asana
    });
  });
};



/**
 * puts/updates a a task to the local db
 * @param  {Object} asanaTaskObject
 * @param  {Object} destDb - PouchDB object
 * @return {Promise}
 */
AsanaWrapper.prototype.pushTaskLocal = function(asanaTaskObject, destDb) {
  var _this = this;
  return new Promise(function pushTaskLocalP(resolve, reject){
    _this.dbTools.pouchSet(destDb, asanaTaskObject.id.toString(), asanaTaskObject)
      .then(function pushTaskLocalS(dbResponse){
        resolve(asanaTaskObject);
      })
      .catch(reject);
  });
};



/**
 * purges asana of all tasks in configured workspace
 * @return {[type]} [description]
 */
AsanaWrapper.prototype.purge = function() {
  var _this = this;
  return new Promise(function purgeP(resolve, reject){
    if (!_this.projects.length) {
      reject(new Error('No asana projects specified!'));
      return;
    }
    var wsTasks = _this.client.getTasksProject(_this.projects[0], null,
        function purgeTasksFetched(error, taskWrapper) {
            _this.logger.debug("Items returned from Asana:", taskWrapper);
            //purge fetched tasks
            if (error) {
              reject(error);
              return;
            }
            if (taskWrapper.errors) {
                reject(new Error("Unable to fetch tasks to purge"));
                return;
            }
            if (!taskWrapper.data.length) { // nothing to purge
              resolve(0);
              return;
            }
            var purgedPromises = taskWrapper.data.map(
                function PurgeAsanaTask(item,ndx,arry) {
                  _this.logger.verbose(":: Initiating purge on all asana tickets");
                  return new Promise(function PurgeAsanaTaskP(resolve, reject){
                    _this.client.deleteTask(item.id, function(error, data){
                      if(error) reject(error);
                       resolve(data);
                       _this.logger.verbose("  task id: %d deleted", item.id);
                      });
                    });
                }
            );
            //handle results of async purge
            Promise.all(purgedPromises)
                .then(function ResetLastUpdateTime(){
                    return _this.dbconfig.destroy(function(err, info){
                      if (err) {
                        reject(err);
                        return;
                      }
                    });
                })
                .then(function PurgeAsanaTasksSuccess(){
                    _this.logger.verbose(":: Asana tasks purged successfully!");
                    resolve(purgedPromises.length);
                })
                .catch(function PurgeAsanaTasksFail(error){
                    _this.logger.error('Asana tasks failed to be deleted', JSON.stringify(error,null,2));
                    reject("fail");
                    return;
                });
        }
    );
  });
};



/**
 * updates a task remote and locally
 * @param  {Object} asanaTaskObject
 * @param  {string|Number} id
 */
AsanaWrapper.prototype.updateItem = function(asanaTaskObject, id) {
  var _this = this,
      destDb = (asanaTaskObject.complete === 'true' ? _this.dbC : _this.dbI);
  return new Promise(function updateTaskP(resolve, reject) {
    _this.updateTaskRemote(asanaTaskObject, id.toString())
      .then(function setToServerTask(serverTask){
        asanaTaskObject = serverTask;
        return serverTask;
      })
      .then(function deleteLocalCB(task){ //purge existing before writing the new
        return _this.deleteLocalTask(id);
      })
      .then(function pushLocalCB(){ return _this.pushTaskLocal(asanaTaskObject, destDb);})
      .then(resolve, reject)
      .catch(reject);
  });
};



/**
 * updates remote task
 * @param  {Object} asanaTaskObject - incomplete or complete task
 * @param  {string} id - task to update
 * @return {Promsie}
 */
AsanaWrapper.prototype.updateTaskRemote = function(asanaTaskObject, id){
  var _this = this;
  return new Promise(function updateTaskP(resolve, reject){
    _this.client.updateTask(id, asanaTaskObject, function(error, response){
      if (error) {
        _this.logger.error('(AsanaWrapper - updateRemoteTask) Could not update remote task', JSON.stringify(error));
        reject(error);
        return;
      } else {
        resolve(response.data); //return the new ticket from asana
      }
    });
  });
};

// export the class
module.exports = AsanaWrapper;
