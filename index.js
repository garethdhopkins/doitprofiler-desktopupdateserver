'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const app = express();
const packageJSON = require('./package.json');
const minidump = require('minidump');
const bodyParser = require('body-parser');
const PORT = parseInt(process.env.PORT);

app.use(require('morgan')('dev'));

app.use('/updates/releases', express.static(path.join(__dirname, 'releases')));
app.use(require('connect-busboy')());

app.get('/updates/latest', (req, res) => {
    const clientVersion = req.query.v;
    const platform = req.query.p || 'darwin';
    const arch = req.query.a || 'x64';
    const latest = getLatestRelease(platform,clientVersion,arch);
    if(clientVersion === latest){
        res.status(204).end();
    }else{
        res.json({ url : `${getBaseUrl()}/releases/darwin/${latest}/${packageJSON.zipFilename}.zip` });
    }
});
app.post('/viewReport',bodyParser.urlencoded({ extended: false }),(req,res)=>{
    let filename = req.body.dump;
    if(!filename){
        sendError(res,'No file found');
        return;
    }
    minidump.walkStack(path.resolve(__dirname,'dumps',filename),function(error,report){
        if(error){
            sendError(res,error);
            return;
        }
        res.set('Content-Type', 'text/plain');
        res.send(new Buffer(report));
    });
});
app.get('/viewReport',(req,res)=>{
    let dumpDir = path.join(__dirname,"dumps");
    fs.stat(dumpDir,(e,s)=>{
        if(e || !s.isDirectory()) fs.mkdirSync(dumpDir);
        fs.readdir(dumpDir,(err, files)=>{
            if(err){
                sendError(res,err);
                return;
            }
            let page = "<h1>Crash reports</h1>\n";
            page += "<h2>Chose a dump file to display</h2>\n";
            page += "<ul>\n";
            files.forEach(file=>{
                if(file.match(/^\..+$/)) return;
                page += "\t<li>\n";
                page += "\t\t<form method=\"POST\">\n";
                page += "\t\t\t<input type='submit' value='"+file+"' name='dump'/>\n";
                page += "\t\t</form>\n";
                page += "\t</li>\n";
            });
            page += "</ul>\n";
            res.set('Content-Type', 'text/html');
            res.send(page);
        });
    });
});

app.post('/crashReporter',bodyParser.urlencoded({ extended: false }),(req, res) => {
    var savePath;
    console.log(JSON.stringify(req.body,null,2));
    console.log('guid: '+req.body.guid);
    req.busboy.on('file',(fieldname, file, filename, encoding, mimetype)=>{
        savePath = path.join(__dirname,'dumps',filename);
        file.pipe(fs.createWriteStream(savePath));
    });
    req.busboy.on('field',function(field,value){
       console.log("field data:\n"+field+": "+value);
    });
    req.busboy.on('finish',()=>{
        res.status(200).end();
    });
    return req.pipe(req.busboy);
});

let getLatestRelease = (platform, version, arch) => {
    const dir = path.resolve(__dirname,'releases',platform);

    if(platform == 'darwin'){
        return fs.readdirSync(dir).filter((file) => {
            const filePath = path.join(dir, file);
            return fs.statSync(filePath).isDirectory();
        }).reverse()[0];
    }
    const filename = path.join(dir,arch,'RELEASES');
    if(!fs.existsSync(filename)) return version;
    return fs.readFileSync(filename,'utf8','r').split("\n").reverse()[0].split(' ')[1].replace(/^([a-zA-z]+-)(([0-9]+(\.)?)+)(-full\.nupkg)$/,"$2");
};

let getBaseUrl = () => {
    return (process.env.PROD ? packageJSON.productionURL : 'http://localhost')+(PORT ? ':'+PORT : '');
};
let sendError = (res, error) => {
    res.set('Content-Type', 'text/html');
    res.send('<h1 style="color:#a00;text-align:center;">Sorry, an ERROR occured</h1><small style="color:#eb0000;"><pre>'+error+'</pre></small>');
};

app.listen(PORT, () => {
    console.log(`Express server listening on port ${PORT}`);
});