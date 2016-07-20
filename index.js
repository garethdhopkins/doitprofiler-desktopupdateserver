'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const https = require('https');
const stream = require('stream');
const app = express();
const packageJSON = require('./package.json');
const minidump = require('minidump');
const bodyParser = require('body-parser');
const PROD = process.env.PROD || 1;
const PORT = process.env.PORT || 8080;

app.use(require('morgan')('dev'));

app.use('/updates/releases', express.static(path.join(__dirname, 'releases')));
app.use(require('connect-busboy')());

let getFilesBaseUrl = () => {
    return PROD ? packageJSON.productionURL : 'http://localhost'+((PORT && (parseInt(PORT) > 0)) ? ':'+PORT : '');
};
let sendError = (res, error) => {
    res.set('Content-Type', 'text/html');
    res.send('<h1 style="color:#a00;text-align:center;">Sorry, an ERROR occured</h1><small style="color:#eb0000;"><pre>'+error+'</pre></small>');
};
let createLatestResponse = (req, res, qres) => {
    const clientVersion = req.query.v;
    const platform = req.query.p || 'darwin';
    const arch = req.query.a || 'x64';
    const latest = qres.latest || qres;
    if(clientVersion === latest){
        res.status(204).end();
    }else{
        platform == 'darwin' ?
            res.json({ url : qres.url || `${getFilesBaseUrl()}/darwin/${latest}/${packageJSON.zipFilename}.zip` }) :
            res.json({ url : `${getFilesBaseUrl()}/win32/${arch}` })
    }
};
let createFilesTable = (res, message) => {
    getFileContent(getFilesBaseUrl()+'/files.json')
        .then(content => {
            let page = "<h1>Files to download</h1>\n";
            page += content.downloads.length ?
                "<h4>Chose a file to download</h4>\n<table>\n\t<tr><th>Filename</th><th>Size</th><th>Last modified date</th><th>Platform</th><th>&nbsp;</th></tr>" :
                "<h4>No files do download</h4>\n";
            content.downloads.forEach(file => {
                let lm = new Date(file.lastModified);
                page += "\t<tr>\n";
                page += "\t\t<td>"+file.fileName+"</td>\n";
                page += "\t\t<td>"+file.size+"</td>\n";
                page += "\t\t<td>"+lm.toLocaleDateString()+" "+lm.toLocaleTimeString()+"</td>\n";
                page += "\t\t<td>"+file.platform+"</td>\n";
                page += "\t\t<td>\n";
                page += "\t\t\t<form method=\"GET\">\n";
                page += "\t\t\t\t<input type='submit' value='Download' class='btn btn-success' />\n";
                page += "\t\t\t\t<input type='hidden' value='"+file.fileName+"' name='f' />\n";
                page += "\t\t\t</form>\n";
                page += "\t\t</td>\n";
                page += "\t</tr>\n";
            });
            page += content.downloads.length ? "</table>\n" : "";
            res.set('Content-Type', 'text/html');
            fs.readFile(path.resolve(__dirname,'download.html'), function (err, content) {
                if(err) return sendError(res,err);
                return res.send(content.toString().replace('#page#', page).replace('#message#', message || ''));
            });
        }, e => sendError(res,e))
        .catch(e => sendError(res,`ERROR: ${e}`));
};

app.get('/download',(req,res)=>{
    let fileName = req.query.f;
    if(fileName){
        // return getFileContent(getFilesBaseUrl()+"/"+fileName,res,fileName)
        //     .then(null,e => createFilesTable(res,e)).catch(e => createFilesTable(res,`ERROR: ${e}`));
        return res.redirect(getFilesBaseUrl()+"/"+fileName);
    }
    createFilesTable(res);
});
app.get('/info', (req, res) => {
    res.json({ 
        productionUrl : `${packageJSON.productionURL}`, 
        port : `${PORT}`, 
        baseUrl : `${getFilesBaseUrl()}`
    });
});
app.get('/updates/latest', (req, res) => {
    const platform = req.query.p || 'darwin';
    const arch = req.query.a || 'x64';
    if(platform == 'darwin'){
        return getFileContent(getFilesBaseUrl()+"/darwin/latest")
            .then(latest => createLatestResponse(req,res,latest), e => res.status(404).end())
            .catch(e => res.status(404).end());
    }
    getFileContent(getFilesBaseUrl()+"/win32/"+arch+"/RELEASES")
        .then(content => createLatestResponse(req,res,content.split("\n").reverse()[0].split(' ')[1].replace(/^([a-zA-z]+-)(([0-9]+(\.)?)+)(-full\.nupkg)$/,"$2")), e => res.status(404).end())
        .catch(e => res.status(404).end());
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
    // console.log(JSON.stringify(req.body,null,2));
    // console.log('guid: '+req.body.guid);
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

let getFileContent = (fileAddress, response, fileName) => {
    return new Promise((success, error) => {
        (fileAddress.match(/^https/) ? https : http).get(fileAddress, res => {
            let isBuffer = response && res.statusCode < 400;
            let myBuff = '';
            let isJSON = !isBuffer && res.headers['content-type'].match(/json/i);
            if(isBuffer){
                res.setHeader('Content-disposition', 'attachment; filename='+fileName);
                res.pipe(response);
            }else{
                let charset = res.headers['content-type'].match(/(^.*charset=)(.+$)/) ? (res.headers['content-type'].replace(/(^.*charset=)(.+$)/, "$2") || 'utf-8').replace('-', '') : 'utf8';
                res.setEncoding(charset).on('data', d => myBuff += d);
                res.on('end', () => res.statusCode > 399 ?
                    error(`ERROR ${res.statusCode}: ${myBuff}`) :
                    success(isJSON ? JSON.parse(myBuff) : myBuff));
            }
        }).on('error', e => error(e.message));
    });
};

app.listen(PORT, () => {
    console.log(`Express server listening on port ${PORT}`);
});