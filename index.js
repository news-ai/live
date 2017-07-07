var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var port = process.env.PORT || 3000;

app.get('/', function(req, res) {
    res.sendFile(__dirname + '/index.html');
});

function generatePageTeamIdHash(page, teamId) {
    // body...
}

io.on('connection', function(socket) {
    // On authentication connection (Initial connection)
    console.log(socket.id)
    socket.on('auth', function(msg) {
        console.log(msg);

        var authSuccessful = false;

        // Validate if their authentication is valid

        // If it is not valid then disconnect their socket
        // and message them back
        if (!authSuccessful) {
            socket.json.send({'Status': 'Failure'});
            socket.disconnect(true);
        }

        // Join the current page they are on (room)
        // Hash of their current page and team id

        // Respond back to the client that their authentication
        // is successful
        // socket.json.send({ your : 'data' });
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