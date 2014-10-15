/*jslint node: true */

//service libs - add wrappers here
var AsanaWrapper = require('./asanaWrapper.js'),
    Syncer = require('./syncer.js'),
    ZenWrapper = require('./zenWrapper.js');
    //add addtional wrappers here


//init db names - adjust to your services.  recommend using x-yycomplete nomenclature
var dbtypes = {
    config: 'az-config',
    syncs: 'az-syncs',
    service1Complete: 'zen-complete',
    service1Incomplete: 'zen-incomplete',
    service2Complete: 'asana-complete',
    service2Incomplete: 'asana-incomplete'
};

// field mapping - all service wrappers shall have an itemMap function, that
// returns a generic object with a corresponding value to each of these based
// on the objects current state
// TODO: 'assignee_id' name matching
var map = [
    'description',
    'complete',
    'title',
    'id'
];

// initialze services and syncer (if asani, see the api docs
// for using CURL to get a few of these values)
var asana = new AsanaWrapper({
  apiKey: 'YOUR-API-KEY',
  workspace: SOME-WORKSPACE-NUMBER,
  projects: [SOME-PROJECT-NUMBER]
});

var zen = new ZenWrapper({
  username:  'YOUR-USER-NAME',
  token:     'YOUR-API-TOKEN',
  remoteUri: 'https://coins.zendesk.com/api/v2'
});


// Exported configuration object
var SyncerConfig = {
    dbs: dbtypes,
    pollingInterval: 300, // seconds
    service1: { // match the service and the name
        service: zen,
        name: 'zen'
    },
    service2: {
        service: asana,
        name: 'asana'
    },
    bindService1to2: true,
    bindService2to1: false,
    fieldmap: map,
};

//Nodeme
module.exports = SyncerConfig;
