task-syncer
===========

Synchronizes tasks between two web services.  I.e, sync asana tasks and zen-desk tasks!

The syncer works by periodically polling one service, the other service, or both.  Based on your configuration, it pulls down and parses tasks, and creates a generic item that can be converted into the other service's data-type.  The syncer, then, on a user specified time interval, pushes those tasks out to the remotes and reads in any new.  If the syncer goes down, fear not, it remembers when it last updated, and queries for updates based on when it last synced (plus some buffer time to compensate for a slow webservice).

Bundled, but not required, is a db web inspector, enabling you to quickly glimpse inside the syncer's local db!  Think of a read-only, dumbed down phpmyadmin.

**The config file is listed in .gitignore**.  Be mindful passing docs with your service api keys! :)

#Setup
* Clone this repo! `git clone https://github.com/MRN-Code/task-syncer.git`
* Copy the js/syncConfigTemplate.js to js/syncConfig.js.  From the dir root, `cp js/syncConfigTemplate.js js/syncConfig.js`
* Update the syncConfig.js file to match your configuration.

From the root directory:

## Update module and submodule
### All at once
```bash
git pull &&
npm update &&
git submodule init &&
git submodule foreach "(git checkout master; git pull origin master; npm-update)&"
```

### Bit by bit
#### Git - pull latest files from remote
* git pull
* git submodule init
* git submodule foreach update

#### NPM
* npm update from the root module
* npm update from js/lib/* directories
* NOTES:
  *node-zendesk (node_modules/node-zendesk/client/client.js) has a bug out-of-the box.  It has been fixed on github but not in version 0.0.10 in npm.  You may need to manually update that file from git.
  *asana-api from npm does not have sufficient functionality.  Use the cdaringe/asana-api git for the asanai-api (included by default).

## Setup daemon
* We use PM2 to manage our node processes.  Checkout PM2 to learn how to boot this app.  `pm2 start server.js` for the quick n dirty.
    * DEPRECATED: We use an init.d bash script to run node's forever pluggin, that keeps the server up.  Make sure to use intelligent logging and limit how many times forever can reboot itself!
      * Consult NI Docs > Ubuntu Node Server Setup for full instructions!  Logging releated steps may be disregarded as task-syncer handles logging differently than listed.
      * Our bash script is in scripts/node-server. `sudo cp scripts/node-server /etc/init.d/`

# Usage
* run: `node server.js`
* It makes sense to have a daemon.  The daemon should auto start.  The following parameters may be passed:
  * `nosync` - turns off default autosync
  * `purge2` - purges service 2 remote items
  * `purgel` - purges all local dbs.  Regenerated on sync
  * `sync` - initiates an immediate sync
  * `debug` - changes logging level to debug, disables autosync, and routes remote asana items to the sandbox dir
  * `-v` or `verbose` - changes logging level to verbose

  * Example: `node server.js nosync purgel` - Starts a server that will never automatically sync (you can sync via the webgui, if used), and purges the databases to start syncing from a clean state.

# ToDo
* Lots.  Currently only setup for functionality of one way syncing, service 1 to service 2.
