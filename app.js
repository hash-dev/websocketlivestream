// module dependencies
var express = require('express');
var path = require('path');
var bodyParser = require('body-parser');
var fs = require('fs');
var _ = require('underscore');

// enable usage of all available cpu cores
var cluster = require('cluster'); // required if worker id is needed
var sticky = require('sticky-session');

// helper vars
var mpgDashSegmentsPath = 'res/dashsegments/',
    broadcastQueue = [],
    isBroadcasting = false; // Prototype 1

// init and configure express webserver
var app = express();
var httpServer = require('http').createServer(app, function(req, res) {
    res.end('worker: ' + cluster.worker.id);
});

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// init node server for all available cpu cores
if (!sticky.listen(httpServer, 8080)) {
    httpServer.once('listening', function() {
        console.log('Started webserver, listening to port 8080');
    });
} else {

    var WebSocketServer = require('ws').Server;
    var wss = new WebSocketServer({ server: httpServer });

    var serverId = cluster.worker.id;
    console.log('Initiate server instance ' + serverId);
    var sockets = [];

    wss.on('connection', function(ws) {
        sockets.push(ws);

        if (ws.upgradeReq.url === '/stream') {
            startPlaying();
            ws.on('close', function() {
                ws = null;
            });
        }
    });
}

// routes
app.get('/', function (req,res){
  res.render('index', {
        title: 'WebSocket Livestream',
        teaser: 'The prototype provides push-based live streaming capabilities with WebSockets.'
    });
});
app.get('/stream', function(req, res) {
    res.render('stream', {
        title: 'WS Videostream',
        teaser: 'Videostream with WebSockets and MediaSource Plugin'
    });
});

// functions
function startPlaying()
{
    fs.watch(
        mpgDashSegmentsPath,
        {
            persistent: true,
            interval: 1000
        },
        function(curr, prev)
        {
            addToQueue( getMostRecentFile( mpgDashSegmentsPath, /webcam_part\d+_dashinit\.mp4/i ), broadcastQueue);

            if(broadcastQueue.length !== 0 && isBroadcasting === false)
            {
                console.log('Start broadcasting');
                console.log('Read-Stream: '+mpgDashSegmentsPath + broadcastQueue[0]);
                var readStream = fs.createReadStream(mpgDashSegmentsPath + broadcastQueue[0] );
                var count = 0;

                readStream.on('data', function(data)
                {
                    isBroadcasting = true;
                    count++;
                    // logReadStreamData(data.length, count, sockets.length);
                    sockets.forEach(function(ws) {
                        if (ws.readyState == 1) {
                            ws.send(data, { binary: true, mask: false });
                        }
                    });
                });

                readStream.on('end', function() {
                    console.log('ReadStream for ' + broadcastQueue[0] + ' ended');
                    broadcastQueue.shift();
                    isBroadcasting = false;
                });
            }
        }
    );
}

function addToQueue(MostRecentFile, transcodingQueue) {
    var match = 0;

    if(transcodingQueue.length === 0) {
        transcodingQueue.push(MostRecentFile);
    } else {
        for(var i=0; i<transcodingQueue.length;i++) {
            if (transcodingQueue[i] === MostRecentFile) {
                match = 1;
            }
        }
        if(match === 0) {
            transcodingQueue.push(MostRecentFile);
        }
    }
    console.log('Added segment to queue: '+transcodingQueue);
}

// Return only base file name without dir
function getMostRecentFile(dir, regexp) {
    var files = fs.readdirSync(dir);
    var mpgSegments = [];
    var match = '';

    for(var i=0; i<files.length; i++) {
        if(files[i].match( regexp )) {
            match = files[i].match( regexp );
            mpgSegments.push( match[0] );
        }
    }

    // use underscore for max()
    return _.max(mpgSegments, function (f) {
        var fullpath = path.join(dir, f);

        // ctime = creation time is used
        // replace with mtime for modification time
        console.log('Most recent file: '+fs.statSync(fullpath).ctime);
        return fs.statSync(fullpath).ctime;
    });
}

function logReadStreamData(data, count, socketLength)
{
    console.log("Type: " + typeof data + ", Size: " + data.length);
    console.log('Sending chunk of data: ' + count);
    console.log("Sending to " + socketLength + " sockets");
}