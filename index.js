var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;
var Q = require('q');

app.get('/', function(req, res) {
    res.sendFile(__dirname + '/index.html');
});

function validateUser(userId, accessToken) {
    var deferred = Q.defer();

    return deferred.promise;
}

function generatePageTeamIdHash(page, teamId) {
    
}

io.on('connection', function(socket) {
    // On authentication connection (Initial connection)
    socket.on('auth', function(authDetails) {
        // Validate if their authentication is valid
        validateUser(authDetails.userId, authDetails.accessToken).then(function(status) {
            // Join the current page they are on (room)
            // Hash of their current page and team id
            var roomName = generatePageTeamIdHash(authDetails.page, authDetails.teamId);
            socket.join(roomName);

            // Respond back to the client that their
            // Authentication is successful
            socket.json.send({'Status': 'Success'});
        }, function(error) {
            // If it is not valid then disconnect their socket
            // And message them back
            socket.json.send({'Status': 'Failure'});
            socket.disconnect(true);
        });
    });

    // Listens to things when they are changed
    // Ping the whole team that is currently on that page
    // or actually, anyone on that page
    socket.on('change', function(changeDetails) {
        console.log(changeDetails);

        if (changeDetails.resourceName === 'page') {
            // Remove from all other page rooms that this socket is currently in
            var rooms = io.sockets.adapter.sids[socket.id];
            for(var room in rooms) {
                if (room !== socket.id) {
                    socket.leave(room);
                }
            } 

            // If there is a page they have changed to then
            // add them to that room
            if (changeDetails.page && changeDetails.page !== '') {
                var roomName = generatePageTeamIdHash(123, changeDetails.page)
                socket.join(roomName);
            }
        } else if (changeDetails.resouceName === 'contact' || changeDetails.resouceName === 'list') {
            // Tell everyone in that particular room that contact/list change has happened
        }

        io.emit('change', 'gg');
    });
});

http.listen(port, function() {
    console.log('listening on *:' + port);
});