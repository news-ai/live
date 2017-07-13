'use strict';

// Import external libraries
var app = require('express')();
var Q = require('q');
var bodyParser = require('body-parser');

// Import databases
var elasticsearch = require('elasticsearch');
var redis = require('redis');

// Set up Express
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;

// Instantiate a elasticsearch/redis client
var client = redis.createClient();
var elasticSearchClient = new elasticsearch.Client({
    host: 'https://newsai:XkJRNRx2EGCd6@search.newsai.org',
    rejectUnauthorized: false
});

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: true
}));

app.get('/', function(req, res) {
    res.sendFile(__dirname + '/index.html');
});

app.post('/email', function(req, res) {
    var data = req.body;
    // Check if user is online
    userIdToSocketIds(data.userId).then(function(socketIds){
        // If the user is not online then we add them
        // to redis, and notify them when they come
        // online
        if (socketIds === '') {
            // Save it for when the user is back
            var emailNotificationHash = 'email_notification_' + data.emailId;
            client.hmset(emailNotificationHash, data);

            var userNotificationHash = 'user_notification_' + data.userId;
            client.get(userNotificationHash, function(err, unsentUserNotifications) {
                var newUserNotifications = data.emailId;
                if (unsentUserNotifications) {
                    newUserNotifications = unsentUserNotifications.toString() + ',' + newUserNotifications;
                }
                client.set(userNotificationHash, newUserNotifications);

                res.setHeader('Content-Type', 'application/json');
                res.send(JSON.stringify({
                    data: data
                }));
                return;
            });
        } else {
            // Send the notification since they are connected
            // We will message the first one since it will
            // be the newest one
            socketIds = socketIds.split(',');
            var last_socket_id = socketIds[socketIds.length - 1];
            io.sockets.connected[last_socket_id].json.send(data);

            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify({
                data: data
            }));
            return;
        }
    }, function(error) {
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify({
            data: error
        }));
        return;
    });
});

// map of socketId => userId
function socketIdToUserIds(socketId) {
    var deferred = Q.defer();

    var socketIdHash = 'socket_' + socketId;
    client.get(socketIdHash, function(err, reply) {
        if (err) {
            deferred.resolve('');
        }
        deferred.resolve(reply.toString());
    });

    return deferred.promise;
}

// map of userId => socketId
function userIdToSocketIds(userId) {
    var deferred = Q.defer();

    var userIdHash = 'user_' + userId;
    client.get(userIdHash, function(err, reply) {
        if (reply) {
            deferred.resolve(reply.toString());
        }
        deferred.resolve('');
    });

    return deferred.promise;
}

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

            // Set redis for user-specific notifications
            // userId => socketIds[]
            var userIdHash = 'user_' + authDetails.userId;
            client.get(userIdHash, function(err, reply) {
                var socketIds = socket.id;
                if (reply) {
                    socketIds = reply.toString() + ',' + socketIds;
                }
                client.set(userIdHash, socketIds);
            });

            // socketId => userId
            var socketIdHash = 'socket_' + socket.id;
            client.set(socketIdHash, authDetails.userId);

            // Check if there are any pending notifications
            // for the user that is logged in
            var userNotificationHash = 'user_notification_' + authDetails.userId;
            client.get(userNotificationHash, function(err, reply) {
                if (reply) {
                    var stringReply = reply.toString();
                    var notificationIds = reply.split(',');
                    console.log(notificationIds);
                }
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
            // tell people in a team what people are doing
            if (changeDetails.teamId && changeDetails.teamId !== '') {
                socket.join(changeDetails.teamId);
            }
        }

        // Tell everyone in that particular room that list/contact change has happened
        io.to(changeDetails.teamId).emit('message', changeDetails);
        io.to(roomName).emit('message', changeDetails);
    });

    socket.on('disconnect', function() {
        // Remove socketId => userId key
        var socketIdHash = 'socket_' + socket.id;
        client.get(socketIdHash, function(err, socketIdReplys) {
            if (!err) {
                // Remove socketId in userId => socketIds[]
                var userId = socketIdReplys.toString();

                // Update userId => socketIds[] field
                // Remove the socket that has been removed
                var userIdHash = 'user_' + userId;
                client.get(userIdHash, function(err, userIdReply) {
                    if (!err) {
                        var socketIds = userIdReply.toString();
                        socketIds = socketIds.split(',');

                        var index = socketIds.indexOf(socket.id);
                        if (index > -1) {
                            socketIds.splice(index, 1);
                            socketIds = socketIds.join(',');

                            // If socketIds are not empty then we
                            // update userId if not then we
                            // remove userId since the user has no
                            // more active connections
                            if (socketIds !== '') {
                                client.set(userIdHash, socketIds);
                            } else {
                                client.del(userIdHash);
                            }
                        }

                        // remove socketId => userId
                        client.del(socketIdHash);
                    }
                });
            }
        });
    });
});

client.flushall(function(err, succeeded) {
    http.listen(port, function() {
        console.log('listening on *:' + port);
    });
});