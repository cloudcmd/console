(function() {
    'use strict';
    
    var DIR_SERVER      = './',
        
        path            = require('path'),
        child_process   = require('child_process'),
        exec            = child_process.exec,
        spawn           = child_process.spawn,
        
        Util            = require('util-io'),
        
        win             = require('win32'),
        socket          = require(DIR_SERVER    + 'socket'),
        
        equalPart       = Util.isContainStrAtBegin,
        
        ClientFuncs     = [],
        ClientDirs      = [],
        Clients         = [],
        WIN             = process.platform === 'win32',
        
        addNewLine      = function (text) {
            var newLine    = '',
                n           = text && text.length;
            
            if(n && text[n-1] !== '\n')
                newLine = '\n';
            
            return text + newLine;
        },
        
        rmNewLine       = function (text) {
            var strs    = ['\n', '\r'],
                str     = Util.rmStr(text, strs);
            
            return str;
        },
        
        ConNum          = 0,
        
        CHANNEL         = 'console-data';
    
    /**
     * function listen on servers port
     * @pServer {Object} started server object
     */
    exports.init = function() {
        var ret;
        
        ret = socket.on('connection', function(clientSocket) {
            onConnection(clientSocket, function(json) {
                socket.emit(CHANNEL, json, clientSocket);
            });
        });
        
        return ret;
    };
    
    function onConnection(clientSocket, callback) {
        var msg, onDisconnect, onMessage;
        
        ++ConNum;
        
        if (!Clients[ConNum]) {
            msg = log(ConNum, 'console connected');
            
            callback({
                stdout  : addNewLine(msg),
                path    : process.cwd()
            });
            
            Clients[ConNum]             = true;
            
            onMessage                   = Util.exec.with(getOnMessage, ConNum, callback);
            onDisconnect                = function(conNum) {
                Clients[conNum]         =
                ClientFuncs[conNum]     = null;
                
                log(conNum, 'console disconnected');
                
                socket.removeListener(CHANNEL, onMessage, clientSocket);
                socket.removeListener('disconnect', onDisconnect, clientSocket);
            }.bind(null, ConNum);
            
            socket.on(CHANNEL, onMessage, clientSocket);
            socket.on('disconnect', onDisconnect, clientSocket);
        } else {
            msg = log(ConNum, ' in use. Reconnecting...\n');
            
            Util.exec(callback, {
                stdout: msg
            });
            
            socket.disconnect();
        }
    }
    
    /**
     * function gets onMessage function 
     * that execute needed command
     * 
     * @param pConnNum
     * @param callback
     */
    function getOnMessage(connNum, callback, command) {
        var funcExec, firstChar,
            connName, ret,
            
            isVolume    = win.isChangeVolume(command),
            isCD        = command.match(new RegExp('^cd ')),
            isCDWin     = command.match(new RegExp('^cd ', 'i')),
            
            symbolsExec = ['*', '&', '{', '}', '|', '\'', '"'],
            isSymbol    = Util.isContainStr(command, symbolsExec),
            
            CWD         = process.cwd(),
            dir         = ClientDirs[connNum],
            options     = {
                cwd:    dir || CWD
            };
        
        if (!dir)
            dir = ClientDirs[connNum] = CWD;
        
        connName = '#' + connNum + ': ';
        Util.log(connName + command);
        
        if (isCD || isCDWin && WIN || isVolume) {
            ret = true;
            
            onCD(command, dir, function(error, json) {
                var path  = '';
                
                if (!error) {
                    path                = json.path;
                    ClientDirs[connNum] = path;
                }
                
                callback(json);
            });
        }
        
        if (!ret) {
            if (WIN)
                command    = 'cmd /C ' + command;
            
            if (!ClientFuncs[connNum])
                ClientFuncs[connNum] = Util.exec.with(setExec, function(json, error, stderr) {
                    log(connNum, error, 'error');
                    log(connNum, stderr, 'stderror');
                    
                    Util.exec(callback, json);
                });
            
            funcExec        = ClientFuncs[connNum];
            firstChar       = command[0];
            
            if (firstChar === '#') {
                command     = command.slice(1);
                command     = connName + command;
                command     = addNewLine(command);
                
                Util.exec(callback, { 
                    stdout: command
                }, true);
            } else if (WIN || firstChar === ' ' || isSymbol)
                exec(command, options, funcExec);
            else
                setSpawn(command, options, callback);
        }
    }
    
    /**
     * function send result of command to client
     * @param callback
     */
    function setExec(callback, error, stdout, stderr) {
        var json,
            errorStr    = '';
            
        if (stderr)
            errorStr    = stderr;
        else if (error)
            errorStr    = error.message;
        
        json            = {
            stdout : stdout,
            stderr : errorStr
        };
        
        Util.exec(callback, json, error, stderr);
    }
    
    function setSpawn(сommand, options, callback) {
        var cmd, error,
            isSended    = false,
            args        = сommand.split(' '),
            send        = function(error, data) {
                isSended = true;
                
                callback({
                    stderr: error,
                    stdout: data
                });
            },
            sendError     = function(error) {
                isSended = true;
                
                send(error, null);
            };
        
        сommand    = args.shift();
        
        error       = Util.exec.tryLog(function() {
            cmd = spawn(сommand, args, options);
        });
        
        if (error) {
            sendError(error);
        } else {
            cmd.stderr.setEncoding('utf8');
            cmd.stdout.setEncoding('utf8');
            
            cmd.stdout.on('data', function(data) {
                send(null, data);
            });
            
            cmd.stderr.on('data', function(error) {
                sendError(error);
            });
            
            cmd.on('error', function(error) {
                var errorStr    = addNewLine(error + '');
                
                Util.log(error);
                sendError(errorStr);
            });
            
            cmd.on('close', function () {
                cmd = null;
                
                if (!isSended)
                    send(null, null);
            });
        }
    }
    
     function onCD(command, currDir, callback) {
        var isChangeVolume  = win.isChangeVolume(command),
            isVolume        = win.isVolume(command),
            paramDir        = Util.rmStr(command, 'cd '),
            isRootOrHome    = equalPart(paramDir, ['/', '~']),
            getDir          = WIN ? 'chdir' : 'pwd';
        
        if (!isRootOrHome && !isChangeVolume || isVolume) {
            paramDir    =  path.join(currDir, paramDir);
            command     = 'cd ' + paramDir;
        }
        
        exec(command + ' && ' + getDir, {cwd : paramDir}, function (error, stdout, stderr) {
            var errorStr    = '';
            
            if (stderr)
                errorStr    = stderr;
            else if (error)
                errorStr    = error.message;
            
            callback(error || stderr, {
                stderr  : addNewLine(errorStr),
                path    : rmNewLine(stdout)
            });
        });
    }
    
    function log(connNum, str, typeParam) {
        var ret, 
            type       = ' ';
        
        if (str) {
            
            if (typeParam)
                type  += typeParam + ':';
            
            ret        = 'client #' + connNum + type + str;
            
            Util.log(ret);
        }
        
        return ret;
    }
})();