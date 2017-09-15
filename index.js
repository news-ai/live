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

// map of socketId => userId
function socketIdToUserIds(socketId) {
    var deferred = Q.defer();

    var socketIdHash = 'socket_' + socketId;
    client.get(socketIdHash, function(err, userId) {
        if (userId) {
            deferred.resolve(userId);
        }
        deferred.resolve('');
    });

    return deferred.promise;
}

// map of userId => socketId
function userIdToSocketIds(userId) {
    var deferred = Q.defer();

    var userIdHash = 'user_' + userId;
    client.get(userIdHash, function(err, socketId) {
        if (socketId) {
            deferred.resolve(socketId);
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

app.post('/notification', function(req, res) {
    var data = req.body;
    // Check if user is online
    userIdToSocketIds(data.userId).then(function(socketIds) {
        // We're setting the notification anyways.
        // Because we want to send it to the user and add it in-case
        // they don't click the notifications button in that session.
        var resourceNotificationHash = 'resource_notification_' + data.resourceId;
        client.set(resourceNotificationHash, JSON.stringify(data));

        var userNotificationHash = 'user_notification_' + data.userId;
        client.get(userNotificationHash, function(err, unsentNotifications) {
            var newUserNotifications = [data.resourceId];
            if (unsentNotifications) {
                unsentNotifications = unsentNotifications.split(',');
                var dataResourceString = data.resourceId.toString();

                // Remove duplicates
                if (unsentNotifications.indexOf(dataResourceString) > -1) {
                    newUserNotifications = unsentNotifications;
                } else {
                    newUserNotifications = unsentNotifications.concat(newUserNotifications);
                }
            }
            newUserNotifications = newUserNotifications.join(',');
            client.set(userNotificationHash, newUserNotifications);

            // Send the notification since they are connected
            // We will message all of them that there has
            // been a new notification.
            if (socketIds !== '') {
                socketIds = socketIds.split(',');
                var newSocketIds = [];
                for (var i = 0; i < socketIds.length; i++) {
                    var socketId = socketIds[i];
                    if (socketId in io.sockets.connected) {
                        io.sockets.connected[socketId].json.send([data]);
                        newSocketIds.push(socketId);
                    }
                }

                // Automatically update the user hash
                // and remove if any userIdHash are invalid
                var userIdHash = 'user_' + data.userId;
                var newSocketIdStrings = newSocketIds.join(',');
                client.set(userIdHash, newSocketIdStrings);
            }

            res.setHeader('Content-Type', 'application/json');
            res.send(JSON.stringify({
                data: data
            }));
            return;
        });
    }, function(error) {
        res.setHeader('Content-Type', 'application/json');
        res.send(JSON.stringify({
            data: error
        }));
        return;
    });
});

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
            client.get(userIdHash, function(err, socketId) {
                var socketIds = socket.id;
                if (socketId) {
                    socketIds = socketId + ',' + socketIds;
                }
                client.set(userIdHash, socketIds);
            });

            // socketId => userId
            var socketIdHash = 'socket_' + socket.id;
            client.set(socketIdHash, authDetails.userId);

            // Check if there are any pending notifications
            // for the user that is logged in
            var userNotificationHash = 'user_notification_' + authDetails.userId;
            client.get(userNotificationHash, function(err, stringNotificationIds) {
                if (stringNotificationIds) {
                    var notificationIds = stringNotificationIds.split(',');
                    for (var i = 0; i < notificationIds.length; i++) {
                        notificationIds[i] = 'resource_notification_' + notificationIds[i];
                    }

                    // If there are then we send the user all the notifications
                    // we don't delete them here. We delete them when we
                    // get an ping that the user has read their notifications
                    client.mget(notificationIds, function(err, notifications) {
                        var JSONNotifications = [];
                        for (var i = 0; i < notifications.length; i++) {
                            var notification = JSON.parse(notifications[i]);
                            JSONNotifications.push(notification);
                        }
                        socket.json.send(JSONNotifications);
                    });
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

    socket.on('notification', function(notificationDetails) {
        var socketIdHash = 'socket_' + socket.id;
        client.get(socketIdHash, function(err, userId) {
            if (userId) {
                // To tag that the notifications have been read
                if (notificationDetails.notification === 'read') {
                    var userNotificationHash = 'user_notification_' + userId;
                    client.get(userNotificationHash, function(err, stringNotificationIds) {
                        if (stringNotificationIds) {
                            var notificationIds = stringNotificationIds.split(',');
                            for (var i = 0; i < notificationIds.length; i++) {
                                notificationIds[i] = 'resource_notification_' + notificationIds[i];
                            }
                            client.mget(notificationIds, function(err, notifications) {
                                // Tell user that the notifications have been read
                                // Go through all the sockets the user has
                                userIdToSocketIds(userId).then(function(socketIds) {
                                    socketIds = socketIds.split(',');
                                    for (var i = 0; i < socketIds.length; i++) {
                                        var socketId = socketIds[i];
                                        io.sockets.connected[socketId].json.send({
                                            'type': 'notification',
                                            'action': 'read'
                                        });
                                    }

                                    // Delete previous notifications
                                    // and delete the user notifications that
                                    // map that notification.
                                    for (var i = 0; i < notifications.length; i++) {
                                        client.del(notificationIds[i]);
                                    }
                                    client.del(userNotificationHash);
                                }, function(error) {
                                    // If it is not valid then disconnect their socket
                                    // And message them back
                                    console.error(error);
                                    socket.json.send({
                                        'type': 'notification',
                                        'error': error,
                                        'action': 'not read'
                                    });
                                });
                            });
                        }
                    });
                }
            }

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

    // When a particular client disconnects
    // then we update the redis settings so
    // we don't send them notifications anymore
    socket.on('disconnect', function() {
        // Remove socketId => userId key
        var socketIdHash = 'socket_' + socket.id;
        client.get(socketIdHash, function(err, userId) {
            if (userId) {
                // Remove socketId in userId => socketIds[]
                // Update userId => socketIds[] field
                // Remove the socket that has been removed
                var userIdHash = 'user_' + userId;
                client.get(userIdHash, function(err, userIdReply) {
                    if (userIdReply) {
                        var socketIds = userIdReply.split(',');

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

// Before we start, we want to remove some previous connections
// so when they disconnect & reconnect, we don't have a bunch of
// dead connections lying around.
client.keys('*', function(err, keys) {
    if (err) return console.log(err);

    // When it is restarted remove all user and socket
    // redis keys. When the server disconnects we reset socketIds
    // and the ones stored don't get removed.
    // We don't want to remove everything since we have notification
    // data left.
    for (var i = 0, len = keys.length; i < len; i++) {
        if ((keys[i].indexOf('user') > -1 && keys[i].indexOf('notification') == -1) || keys[i].indexOf('socket') > -1) {
            client.del(keys[i]);
        }
    }

    http.listen(port, function() {
        console.log('listening on *:' + port);
    });
});

// setInterval(function() {
//     console.log('Running User Clearing Interval')

//     // This looks through all users to see if the socket connections
//     // in their key-value store are still operational.
//     client.keys('user_*', function(err, keys) {
//         // Go through the users & see if their socket Ids are still valid
//         // if not then we remove them
//         var userIdHashs = [];
//         for (var i = 0; i < keys.length; i++) {
//             if (keys[i].indexOf('notification') == -1) {
//                 userIdHashs.push(keys[i]);
//             }
//         }

//         // Get all the sockets of the current user
//         client.mget(userIdHashs, function(err, userSocketsArray) {
//             for (var i = 0; i < userSocketsArray.length; i++) {
//                 var userSockets = userSocketsArray[i].split(',');
//                 for (var x = 0; x < userSockets.length; x++) {
//                     userSockets[x] = 'socket_' + userSockets[x];
//                 }

//                 // Get all of the user sockets so we can see
//                 // which ones are active & which ones are not.
//                 client.mget(userSockets, function(err, userSocketConnections) {
//                     var newSocketArray = [];
//                     for (var y = 0; y < userSocketConnections.length; y++) {
//                         if (userSocketConnections[y]) {
//                             userSockets[y] = userSockets[y].replace('socket_', '');
//                             newSocketArray.push(userSockets[y]);
//                         }
//                     }

//                     if (userSocketConnections.length > 0) {
//                         var userIdHash = 'user_' + userSocketConnections[0];
//                         if (newSocketArray.length === 0) {
//                             client.del(userIdHash);
//                         } else {
//                             var socketIds = newSocketArray.join(',');
//                             client.set(userIdHash, socketIds);
//                         }
//                     }
//                 });
//             }
//         });
//     });
// }, 3 * 60 * 1000);