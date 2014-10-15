var devSyncApp = angular.module(
    'devSyncApp',
        [
            'ngRoute',
            'coinsDirectives'
        ]
);

//Configures the routes and associates each route with a view and a controller
devSyncApp.config(function ($routeProvider) { 
    var relPath = 'partials/';
    $routeProvider
    .when('/',
        {
            controller: 'HomeController',
            templateUrl: relPath + 'home.html'
        })
    .when('/db/:dbname',
        {
        controller: 'DBViewController',
        templateUrl: relPath + 'dbview.html'
    })
    .when('/remote/asana/users',
        {
          controller: 'HomeController',
          templateUrl: relPath + 'users-asana.html'
    })
    .when('/remote/asana/projects',
        {
          controller: 'HomeController',
          templateUrl: relPath + 'projects-asana.html'
    })
    .otherwise({ redirectTo: '/' });
});


angular.module('coinsDirectives', []);
angular.module('coinsDirectives').directive('modalDialog', function() {
  return {
    restrict: 'E',
    scope: {
      show: '='
    },
    replace: true, // Replace with the template below
    transclude: true, // insert custom content inside the directive
    link: function(scope, element, attrs) {
      scope.dialogStyle = {};
      if (attrs.width)
        scope.dialogStyle.width = attrs.width;
      if (attrs.height)
        scope.dialogStyle.height = attrs.height;
      if (!attrs.hasOwnProperty('noClickClose')) {
        scope.hideModal = function() {
            scope.show = false;
            console.dir(attrs);
        };
      }
    },
    templateUrl: '/partials/modals.html'
  };
});

angular.module('coinsDirectives').directive('divpad', function() {
  return {
    restrict: 'E',
    scope: {
      outterClasses: '=outterClasses',
      innerClasses: '=innerClasses',
      hpad: '=hpad'
    },
    replace: true, // Replace with the template below
    transclude: true, // insert custom content inside the directive
    link: function(scope, element, attrs) {
      if (!scope.hpad) scope.hpad = 10;
      if (!outterClasses) outterClasses = 'gray';
      alert(hpad);
    },
    template: '<div ng-class="{{outterClasses}}"><div style="padding:{{hpad}}px" ng-class="{{innerClasses}}"></div></div>'
  };
});