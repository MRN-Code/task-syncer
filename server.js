/*jslint node: true */
var args = process.argv.slice(2),
    assert = require('assert'),
    express = require('express'),
    fs = require('fs'),
    Promise = require('rsvp').Promise,
    utile = require('utile'),
    winston = require('winston');

var logger = new(winston.Logger)({
    transports: [
        new(winston.transports.Console)({
            level: 'info',
            colorize: true
        }),
        new(winston.transports.File)({
            level: 'warn',
            filename: __dirname + '/log/server.log',
            timestamp: true,
            maxsize: 5243000,
            maxFiles: 5
        })
    ]
});

// TODO - sweep all other modules' code to conform whose submodules we use
// require('use-strict'); // use strict on our code - don't enforce it on others
var DBExtend = require('./js/dbextend.js'),
    Syncer = require('./js/syncer.js');

// init logger


// init server
var app = express();
app.set('title', 'SyncGUI');

var port = 8787;
app.configure(function() {
    app.use(express.static('client')); // set the static files location
    app.use(express.logger());
    app.use(express.bodyParser()); // POST user[name]=tobi&user[email]=tobi@learnboost.com, => req.body.user.name
    app.use(express.methodOverride());
});

// init syncer
syncer = new Syncer();

// routes ======================================================================

// api ---------------------------------------------------------------------
app.get('/api/sync', function(req, res) {
    logger.info(":: Syncer Update Requested ::");
    syncer.ready.then(function manualSync(){
        syncer.sync()
            .then(function syncS(r) {
                res.end(":: Syncer Update Complete ::");
            })
            .catch (function syncF(r) {
            res.end(":: Syncer Update Fail ::");
        });
    });
});

app.get('/api/asana/users', function(req, res) {
    logger.info("(user) asana users request");
    syncer.asana.client.getUsers(null, function(error, users) {
        if (error) {
            logger.error(error);
            res.end();
        } else {
            res.end(JSON.stringify(users, null, 2));
        }
    });
});

app.get('/api/asana/projects', function(req, res) {
    logger.info("(user) asana projects request");
    syncer.asana.client.getProjects(null, function(error, projects) {
        if (error) {
            logger.error(error);
            res.end();
        } else {
            res.end(JSON.stringify(projects, null, 2));
        }
    });
});



app.get('/api/zen/resetUpdate', function(req, res) {
    syncer.zen.setLastUpdateTime(0)
        .then(function syncS(r) {
            logger.debug("reset response:", r);
            res.end(JSON.stringify(r));
            return;
        })
        .
    catch (function syncF(e) {
        logger.debug("reset error:", e.stack);
        console.dir(e.stack);
        res.end(r);
        return;
    });
});

/**
 * purges all asana ticket tasks
 */
app.get('/api/asana/purgeweb', function(req, res) {
    var complete = false;
    // timeout if asana unresponsive
    setTimeout(function() {
        if (!complete) res.end("Purge timed out!");
    }, 30 * 1000);
    return syncer.asana.purge()
        .then(function purgeSuccess(n) {
            complete = true;
            res.end(n + " tasks purged!");
        })
        .catch(function purgeFail(error) {
        complete = true;
        res.end(error.message);
    });
});



// get all items in requested database
app.get('/api/:dbname', function(req, res) {
    var dbname = req.params.dbname;
    switch (dbname) {
        case 'az-config':
            db = syncer.dbs.config.db;
            break;
        case 'az-syncs':
            db = syncer.dbs.syncs.db;
            break;
        case 'zen-complete':
            db = syncer.zen.dbC;
            break;
        case 'zen-incomplete':
            db = syncer.zen.dbI;
            break;
        case 'asana-complete':
            db = syncer.asana.dbC;
            break;
        case 'asana-incomplete':
            db = syncer.asana.dbI;
            break;
        default:
            db = false;
    }
    if (db) {
        logger.info('db: ' + dbname);
        // get all docs in the database
        db.allDocs({
            include_docs: true
        }, function allDocsCB(err, response) {
            if (err) logger.error(JSON.stringify(err));
            if (response && response.rows) {
                res.json(response.rows); // return all todos in JSON format
            } else {
                res.json(err);
            }
        });
    } else res.end("No such database: " + dbname);
});



// set item in database
// TODO: UNTESTED and UNUSED. intended use w/ client/AppController.js
app.post('/api/:dbname', function(req, res) {
    var dbname = req.params.dbname;
    db = dbs[dbname];
    logger.debug('Request:', req);
    // pouchSet(db, doc.id.toString(), req.body)
    //     .then(function success(){ res.end(req.body); }) // return all in JSON format
    //     .catch(function error(error){ res.end(error.message);
    // });
});

// application -------------------------------------------------------------
app.get('*', function(req, res) {
    res.sendfile('./client/index.html'); // load the single view file (angular will handle the page changes on the front-end)
});



// Non-api helper functions =======

/**
 * removes all files in a directory, and optionally the folder itself
 * @param  {string} dirPath
 * @param {Boolean} rmFolder - remove the folder itself
 */
purgeDir = function(dirPath, rmFolder) {
    var files;
    rmFolder = rmFolder || 0;
    try {
        files = fs.readdirSync(dirPath);
    } catch (e) {
        logger.error("unable to purge directory", e);
        return;
    }
    if (files.length > 0) {
        for (var i = 0; i < files.length; i++) {
            var filePath = dirPath + '/' + files[i];
            logger.verbose("Deleting: ", filePath);
            if (fs.statSync(filePath).isFile())
                fs.unlinkSync(filePath);
            else
                purgeDir(filePath);
        }
    }
    if (rmFolder) fs.rmdirSync(dirPath);
};



/**
 * asana purge callback - success
 * @param  {*} r - response, items purged
 */
function asanaPurgeSuccess(r) {
  logger.verbose("%d service 2 items purged", r);
}


/**
 * asana purge callback - fail
 * @param  {Error} e
 */
function asanaPurgeFail(e) {
  logger.warn('Purge failed', e);
}




/**
 * sync callback - failure
 * @param  {Error} e
 */
function syncFail(e) {
  logger.error('(server) sync failed', e);
}

//Sync single zen asana syncer
//nosync - turns off default autosync
//purge2 - purges service 2 remote items
//purgel - purges local items
//sync - initiates an immediate sync
//debug - changes logging level to debug, disables autosync
//-v or verbose - changes logging level to verbose
logger.debug('arguments:', args);
while (args.length) {
    if (typeof args[0] === 'string') {
        if (args[0].match(/nosync/i)) {
            logger.info('autosync disabled');
            syncer.disableAutoSync();
        } else if (args[0].match(/purge2/i)) {
            logger.verbose(":: Server requested service2 purge ::");
            syncer.asana.purge()
                .then(asanaPurgeSuccess)
                .catch(asanaPurgeFail);
        } else if (args[0].match(/purgel/i)) {
            purgeDir(__dirname + '/db');
            logger.warn(__dirname + '/db - purged');
            logger.verbose("Generating new syncer to spawn new dbs...");
            syncer = new Syncer();
        } else if (args[0].match(/sync/i)) {
            syncer.sync().
            catch(syncFail);
        } else if (args[0].match(/debug/i)) {
            logger.transports.console.level = 'debug';
            syncer.logger.transports.console.level = 'debug';
            logger.debug("debug mode activated");
            syncer.disableAutoSync();
            syncer.asana.projects = [11639752747057]; //sandbox
            port = 8787;
        } else if (args[0].match(/-v/i) || args[0].match(/verbose/i)) {
            if (logger.transports.console.level !== 'debug') {
                logger.transports.console.level = 'verbose';
                logger.verbose("Verbose activated");
            }
        }
    }
    args.shift();
}

// listen (start app with node server.js) ======================================
app.listen(port);
logger.info("App listening on port " + port);
