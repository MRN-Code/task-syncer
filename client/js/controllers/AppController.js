/*jslint node: true */
devSyncApp.controller('AppController', function ($scope, $rootScope, $http, $routeParams) {
  $scope.appc = {
    modalPageChange: false,
    modalFunc: false,
    modalServer: function(){return $scope.appc.modalPageChange || $scope.appc.modalFunc; }
  };
  $scope.formData = {};
  $scope.selectedDB = "Select a Database!";
  $scope.dbdump = '';
  $scope.dbDisplayCols = {
    zenC: ['id','title','description','status'],
    zenI: ['id','title','description','status'],
    asanaI: ['id','title','notes','completed'],
    asanaC: ['id','title','notes','completed']
  };

  function wait(b){
    if(b) $scope.modalFunc = true;
    else $scope.modalFunc = false;
  }

  /*
   * Modal
   */
   $scope.togglePageChangeModal = function(forceBool){
    $scope.appc.modalPageChange = forceBool;
    console.log("page modal: " + $scope.appc.modalPageChange.toString() + " // global modal: " + $scope.appc.modalServer().toString());
  };

  $rootScope.$on('$locationChangeStart', function() {
    if (!$scope.appc.modalPageChange) $scope.togglePageChangeModal(true);
    console.log("location change started - modal on");
  });

  $scope.$on('$viewContentLoaded', function(){
    $scope.togglePageChangeModal(false);
    console.log("content ready - modal off");
  });
  /* end Modal */


  // API
  $scope.getDBDocs = function(dbname) {
    console.log("Fetching db: " + dbname);
    $http.get('/api/' + dbname)
        .success(function dbDocFetchSuccess(data) {
            if (data.error) {
                console.error(data);
            }
            $scope.dbdump = JSON.stringify(data, undefined, 4);
            $scope.docList = data;
            $scope.selectedDB = dbname;

        })
    .error(function dbDocFetchFail(data) {
      $scope.selectedDB = dbname + ' not found!';
      console.log('Error: ' + data);
    });
  };



  $scope.getAsanaUsers = function() {
    wait(true);
    if ($scope.usersAsana && $scope.usersAsana.data) {
      wait(false);
      return;
    }
    $http.get('/api/asana/users')
    .success(function(data) {
      $scope.usersAsana = data;
      wait(false);
    })
    .error(function(data) {
      console.log('Error: ' + data);
      wait(false);
    });
  };



  $scope.getAsanaProjects = function() {
    wait(true);
    if ($scope.projectsAsana && $scope.projectsAsana.data) {
      wait(false);
      return;
    }
    $http.get('/api/asana/projects')
    .success(function(data) {
      $scope.projectsAsana = data;
      wait(false);
    })
    .error(function(data) {
      console.log('Error: ' + data);
      wait(false);
    });
  };



  $scope.purgeAsanaWebTasks = function() {
      //TODO: OPEN MODAL AND PROMPT before purging
      wait(true);
      $http.get('/api/asana/purgeweb')
      .success(function purgeAsanaWebTasksS(data){
        wait(false);
        alert("Purge completed! [" + data + "]");
      })
      .catch(function purgeAsanaWebTasksF (e) {
        wait(false);
        alert("Purge failed");
        console.dir(e);
      });
  };



  $scope.zenResetUpdateTime = function(){
    wait(true);
    $http.get('/api/zen/resetUpdate')
    .success(function(data){
      wait(false);
      alert("Success - update time reset // ", JSON.stringify(data,null,2));
    })
    .catch(function(error){
      wait(false);
      alert("Failure - update time failed // ", JSON.stringify(error,null,2));
    });
  };



  $scope.sync = function() {
    //TODO: OPEN MODAL AND PROMPT before purging
    wait(true);
    $http.get('/api/sync')
    .success(function sync(data){
      wait(false);
    });
  };



  /*
   * TODO: not implemented local or server side
   */
  $scope.updateDoc = function(doc) {
    $http.post('/api/' + $scope.selectedDB, doc)
    .success(function(data){
      alert(data);
    })
    .catch(function(error){
      alert(error);
    });
  };
});
