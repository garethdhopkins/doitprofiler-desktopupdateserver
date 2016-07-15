'use strict';
const fs = require('fs');
const fsU = require('nodejs-fs-utils');
const path = require('path');
const express = require('express');
const http = require('http');
const https = require('https');
const app = express();
const packageJSON = require('./package.json');
const minidump = require('minidump');
const bodyParser = require('body-parser');
const PROD = process.env.PROD || 1;
const PORT = process.env.PORT || 8080;

app.use(require('morgan')('dev'));

app.use('/updates/releases', express.static(path.join(__dirname, 'releases')));
app.use(require('connect-busboy')());

let getBaseUrl = () => {
    return (PROD ? packageJSON.productionURL : 'http://localhost')+((PORT && (parseInt(PORT) > 0)) ? ':'+PORT : '');
};
let sendError = (res, error) => {
    res.set('Content-Type', 'text/html');
    res.send('<h1 style="color:#a00;text-align:center;">Sorry, an ERROR occured</h1><small style="color:#eb0000;"><pre>'+error+'</pre></small>');
};
let formatSize = size => {
    let out = size;
    let level = -1;
    while(out / 1000 > 0){
        out = Math.floor(out / 1000);
        ++level;
    }
    out = Math.floor(size / Math.pow(10,level*3));
    switch(level){
        case 0: return out+" B";
        case 1: return out+" KB";
        case 2: return out+" MB";
        case 3: return out+" GB";
        default: return size+" B";
    }
};
let getPlatform = fname => {
    switch(fname.replace(/(^.+)(\.[^.]+$)/,"$2")){
        case ".exe":
            let arch = fname.match(/(x64)|(ia32)/) ? fname.match(/(x64)/) ? " - 64 bits" : " - 32 bits" : "";
            return "Windows"+arch;
        case ".app": return "Mac OSX";
        default: return "&nbsp;";
    }
};

app.get('/download',(req,res)=>{

    getFileContent('http://localhost:3333/updates/latest')
        .then(r => console.log(JSON.stringify(JSON.parse(r),null,4)))
        .catch(e => console.error(JSON.stringify(e,null,4)));

    let fileName = req.query.f;
    let filePath = path.resolve(__dirname,'releases','download',fileName || '.');
    if(fileName && path.basename(filePath) == fileName)
        return res.download(filePath);

    // res.setHeader('Content-disposition', 'attachment; filename='+fileName);
    // var filestream = fs.createReadStream(filePath);
    // filestream.pipe(res);
    let dir = path.resolve(__dirname,'releases','download');
    fs.readdir(dir,(err,files)=>{
        if(err) return sendError(res,err);
        let filteredFiles = files.filter((file) => {
            const fp = path.join(filePath, file);
            return !file.match(/^\./);
        });
        let page = "<h1>Files to download</h1>\n";
        page += filteredFiles.length ?
            "<h4>Chose a file to download</h4>\n<table>\n\t<tr><th>Filename</th><th>Size</th><th>Last modified date</th><th>Platform</th><th>&nbsp;</th></tr>" :
            "<h4>No files do download</h4>\n";
        filteredFiles.forEach(file=>{
            let stats = fs.statSync(path.join(dir,file));
            let size = stats.isDirectory() ? fsU.fsizeSync(path.join(dir,file)) : stats.size;
            page += "\t<tr>\n";
            page += "\t\t<td>"+file+"</td>\n";
            page += "\t\t<td>"+formatSize(size)+"</td>\n";
            page += "\t\t<td>"+stats.mtime.toLocaleDateString()+" "+stats.mtime.toLocaleTimeString()+"</td>\n";
            page += "\t\t<td>"+getPlatform(file)+"</td>\n";
            page += "\t\t<td>\n";
            page += "\t\t\t<form method=\"GET\">\n";
            page += "\t\t\t\t<input type='submit' value='Download' class='btn btn-success' />\n";
            page += "\t\t\t\t<input type='hidden' value='"+file+"' name='f' />\n";
            page += "\t\t\t</form>\n";
            page += "\t\t</td>\n";
            page += "\t</tr>\n";
        });
        page += filteredFiles.length ? "</table>\n" : "";
        res.set('Content-Type', 'text/html');


        fs.readFile(path.resolve(__dirname,'download.html'), function (err, content) {
            if(err) return sendError(res,err);
            return res.send(content.toString().replace('#page#', page));
        });
    });
});
app.get('/info', (req, res) => {
    res.json({ 
        productionUrl : `${packageJSON.productionURL}`, 
        port : `${PORT}`, 
        baseUrl : `${getBaseUrl()}`
    });
});
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
        }).reverse()[0] || version;
    }
    const filename = path.join(dir,arch,'RELEASES');
    if(!fs.existsSync(filename)) return version;
    return fs.readFileSync(filename,'utf8','r').split("\n").reverse()[0].split(' ')[1].replace(/^([a-zA-z]+-)(([0-9]+(\.)?)+)(-full\.nupkg)$/,"$2");
};
let getFileContent = fileAddress => {
    console.log('reading '+fileAddress);
    return new Promise((success, error) => {
        (fileAddress.match(/^https/) ? https : http).get(fileAddress, res => {
            let myBuff = '';
            res.setEncoding('utf8').on('data', d => myBuff += d);
            res.on('end',() => success(myBuff));
        }).on('error', e => {
            console.log(`Got error: ${e.message}`);
            error(e);
        });
    });
};

app.listen(PORT, () => {
    console.log(`Express server listening on port ${PORT}`);
});