'use strict';

var elasticsearch = require('elasticsearch');
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;
var Q = require('q');

// Instantiate a elasticsearch client
var elasticSearchClient = new elasticsearch.Client({
    host: 'https://newsai:XkJRNRx2EGCd6@search.newsai.org',
    // log: 'trace',
    rejectUnauthorized: false
});

app.get('/', function(req, res) {
    res.sendFile(__dirname + '/index.html');
});

function validateUser(userId, authToken) {
    var deferred = Q.defer();

    elasticSearchClient.get({
        index: 'users',
        type: 'user',
        id: userId
    }, function(error, response) {
        if (error) {
            console.error(error);
            deferred.reject(error);
        } else {
            if (response._source && response._source.data && response._source.data.LiveAccessToken) {
                if (authToken === response._source.data.LiveAccessToken) {
                    deferred.resolve(true);
                } else {
                    var error = 'Live Access Token is invalid';
                    console.error(error);
                    deferred.reject(error);
                }
            } else {
                var error = 'User does not have live access token';
                console.error(error);
                deferred.reject(error);
            }
        }
    });

    return deferred.promise;
}

String.prototype.hashCode = function() {
    var hash = 5381;
    var i = this.length;
    while (i)
        hash = (hash * 33) ^ this.charCodeAt(--i)
    return hash >>> 0;
}

function generatePageTeamIdHash(page, teamId) {
    var hash = page + teamId;
    return hash.hashCode();
}

io.on('connection', function(socket) {
    // On authentication connection (Initial connection)
    socket.on('auth', function(authDetails) {
        // Validate if their authentication is valid
        validateUser(authDetails.userId, authDetails.authToken).then(function(status) {
            // Join the current page they are on (room)
            // Hash of their current page and team id
            var roomName = generatePageTeamIdHash(authDetails.page, authDetails.teamId);
            socket.join(roomName);

            // Respond back to the client that their
            // Authentication is successful
            socket.json.send({
                'type': 'auth',
                'status': 'success'
            });
        }, function(error) {
            // If it is not valid then disconnect their socket
            // And message them back
            socket.json.send({
                'type': 'auth',
                'status': 'failure'
            });
            socket.disconnect(true);
        });
    });

    // Listens to things when they are changed
    // Ping the whole team that is currently on that page
    // or actually, anyone on that page
    socket.on('change', function(changeDetails) {
        var roomName = generatePageTeamIdHash(changeDetails.page, changeDetails.teamId);
        if (changeDetails.resourceName === 'page') {
            // Remove from all other page rooms that this socket is currently in
            var rooms = io.sockets.adapter.sids[socket.id];
            for (var room in rooms) {
                if (room !== socket.id) {
                    socket.leave(room);
                }
            }

            // If there is a page they have changed to then
            // add them to that room
            if (changeDetails.page && changeDetails.page !== '') {
                socket.join(roomName);
            }

            // Join a team room - so when lists are changed we can
            // tell people in a team
            if (changeDetails.teamId && changeDetails.teamId !== '') {
                socket.join(teamId);
            }
        } else if (changeDetails.resouceName === 'list') {
            // Tell everyone in that particular room that list change has happened
        } else if (changeDetails.resouceName === 'contact') {
            // Tell everyone in that particular room that contact change has happened
        }

        io.to(roomName).emit('message', 'some event');
    });
});

http.listen(port, function() {
    console.log('listening on *:' + port);
});