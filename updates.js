'use strict';

var redis = require('redis');
var client = redis.createClient();

setInterval(function() {
    console.log('Running User Clearing Interval');

    // This looks through all users to see if the socket connections
    // in their key-value store are still operational.
    client.keys('user_*', function(err, keys) {
        // Go through the users & see if their socket Ids are still valid
        // if not then we remove them
        var userIdHashs = [];
        for (var i = 0; i < keys.length; i++) {
            if (keys[i].indexOf('notification') == -1) {
                userIdHashs.push(keys[i]);
            }
        }

        // Get all the sockets of the current user
        client.mget(userIdHashs, function(err, userSocketsArray) {
            if (userSocketsArray && userSocketsArray.length > 0) {
                for (var i = 0; i < userSocketsArray.length; i++) {
                    var userSockets = userSocketsArray[i].split(',');
                    for (var x = 0; x < userSockets.length; x++) {
                        userSockets[x] = 'socket_' + userSockets[x];
                    }

                    // Get all of the user sockets so we can see
                    // which ones are active & which ones are not.
                    client.mget(userSockets, function(err, userSocketConnections) {
                        if (userSocketConnections && userSocketConnections.length > 0) {
                            var newSocketArray = [];

                            // Go through the sockets to see which ones are valid
                            for (var y = 0; y < userSocketConnections.length; y++) {
                                if (userSocketConnections[y] !== null) {
                                    userSockets[y] = userSockets[y].replace('socket_', '');
                                    newSocketArray.push(userSockets[y]);
                                }
                            }

                            if (newSocketArray.length === 0) {
                                client.del(userIdHashs[i]);
                            } else {
                                var socketIds = newSocketArray.join(',');
                                client.set(userIdHashs[i], socketIds);
                            }
                        } else {
                            client.del(userIdHashs[i]);
                        }
                    });
                }
            }
        });
    });
}, 3 * 60 * 1000);