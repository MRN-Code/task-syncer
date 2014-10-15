/*jslint node: true */

//DBExtend.js - static methods that extend the PouchDB functions
var fs = require('fs');
var Promise = require('rsvp').Promise;
var util = require('util');



/**
 * pouchdb extension class
 * constructor
 */
function DBExtend(){
}



/**
 * deletes docs matching a specified id from a database or array of databases
 * @param  {Array|PouchDB} dbArray - PouchDB obj or array of PouchDB obj's
 * @param  {Number|string} id
 * @return {Proimse}
 */
DBExtend.prototype.deleteFromAll = function(dbArray, id){
  var _this = this;
  //permit arrays of dbs, or a single db
  if (!util.isArray(dbArray)){
    if (typeof dbArray === 'object') dbArray = [dbArray];
  }

  return new Promise(function(resolve, reject){
    var deletePs = Promise.reject(true);
    if(!dbArray || dbArray.length === 0) {
        throw new Error("No dbs included");
    }
    deletePs = dbArray.map(function(db){
      return _this.pouchDelete(db, id, true);
    });
    Promise.all(deletePs).then(resolve, reject);
  });
};



/**
 * delete an item from pouchdb
 * @param  {Object} pouchdb reference
 * @param  {String} id
 * @param  {Boolean} notFoundOk - function permitted to resolve if no doc found
 * @return {Promise}
 */
DBExtend.prototype.pouchDelete = function(db, id, notFoundOk){
  notFoundOk = notFoundOk || false;
  return new Promise(function(resolve, reject){
    db.get(id.toString(), function(err, doc){
      if (err) {
        if (err.status == 404 && notFoundOk) resolve(false);
        else reject(err);
      }
      db.remove(doc, function(err, response) {
          if(err) reject(err);
          resolve(true);
        });
      });
  });
};



/**
 * puts new or puts update to pouch
 * @param  {pouchdb isntandce} db - db to write to
 * @param  {string|integer} idv - document key
 * @param  {Object} jsonValue - document, json formatted
 * @param  {function} manipExisting - execute function on found doc
 */
DBExtend.prototype.pouchSet = function(db, idv, jsonValue, manipExisting){
  return new Promise(function pouchSetP(resolve, reject) {
    var key = idv.toString(),
        value = jsonValue,
        existingRev = db.get(key)
          //Update 'put'
          .then(function pouchUpdateExisting(oldDoc) { //old rev exists
            if (manipExisting) jsonValue = manipExisting(oldDoc);
            db.put(jsonValue, key, oldDoc._rev)
                .then(function pouchUpdateExistingS(response){
                  resolve(response);
                })
                .catch(function pouchUpdateExistingF(error){
                  reject(error);
                });
          })
          //New 'put' : error should == not found
          .catch(function pouchPutNew(error){
            if(error.status != 404) reject(error); //404 expected on update
            db.put(jsonValue, key)
              .then(function(response){
                resolve(jsonValue);
              })
              .catch(reject);
          });
    setTimeout(function dbtimeout(){
      reject(new Error('(pouchSet) pouch db timeout'));
    }, 5000);
  });
};



/**
 * writes inbound data to a file in the current directory.
 * Though not DB specific, useful for DB i/o debugging
 * @param  {string} content
 * @param  {string} filename - ex: data.json
 * @param  {string} dir      - save to filepath. defaults to pwd
 *  dir formatted as 'dir1/dir2/'. Assume relative path, and leading /
 * @param  {Function} cb
 * @return {Promise}
 */
DBExtend.prototype.writeFile = function(content, filename, dir, cb){
  return new Promise(function writeFileP(resolve, reject){
    if(!content || !filename){
      reject(new Error("no content or filename supplied"));
    }
    if(dir){
      filename = dir + filename;
    }
    fs.writeFile(filename, content, function(err) {
      if(err) {
        reject(err);
      } else {
        if(cb && typeof cb === 'function') cb();
        resolve(content);
      }
    });
  });
};



/**
 * appends text to a file
 * @param  {string} filename (full path, or just name for pwd)
 * @param  {string} text
 */
DBExtend.prototype.appendFile = function(file, text){
  fs.appendFile(file, text, function (err) {
    if(err) throw err;
  });
};



//Nodeme
module.exports = DBExtend;
