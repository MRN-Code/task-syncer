devSyncApp.controller('DBViewController',
    function ($scope, $routeParams) {
        $scope.dbvc = {
            currentDB: '',
            dbs: [
                'az-config',
                'az-syncs',
                'zen-complete',
                'zen-incomplete',
                'asana-complete',
                'asana-incomplete',
            ]
        };

        //Activate selected db
        if ($routeParams.dbname) {
            $scope.dbvc.currentDB = $routeParams.dbname;
            $scope.getDBDocs($scope.dbvc.currentDB);
        }

        $scope.setPane = function (paneName) {
            var panes = $scope.entry.panes;
            for (var pane in panes) {
                if ( panes.hasOwnProperty(pane) ) {
                    panes[pane] = (pane == paneName) ? true : false;
                }
            }
        };
    }
);
