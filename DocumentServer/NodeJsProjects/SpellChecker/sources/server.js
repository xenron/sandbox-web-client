﻿/*
 * (c) Copyright Ascensio System SIA 2010-2015
 *
 * This program is a free software product. You can redistribute it and/or 
 * modify it under the terms of the GNU Affero General Public License (AGPL) 
 * version 3 as published by the Free Software Foundation. In accordance with 
 * Section 7(a) of the GNU AGPL its Section 15 shall be amended to the effect 
 * that Ascensio System SIA expressly excludes the warranty of non-infringement
 * of any third-party rights.
 *
 * This program is distributed WITHOUT ANY WARRANTY; without even the implied 
 * warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR  PURPOSE. For 
 * details, see the GNU AGPL at: http://www.gnu.org/licenses/agpl-3.0.html
 *
 * You can contact Ascensio System SIA at Lubanas st. 125a-25, Riga, Latvia,
 * EU, LV-1021.
 *
 * The  interactive user interfaces in modified source and object code versions
 * of the Program must display Appropriate Legal Notices, as required under 
 * Section 5 of the GNU AGPL version 3.
 *
 * Pursuant to Section 7(b) of the License you must retain the original Product
 * logo when distributing the program. Pursuant to Section 7(e) we decline to
 * grant you any rights under trademark law for use of our trademarks.
 *
 * All the Product's GUI elements, including illustrations and icon sets, as
 * well as technical writing content are licensed under the terms of the
 * Creative Commons Attribution-ShareAlike 4.0 International. See the License
 * terms at http://creativecommons.org/licenses/by-sa/4.0/legalcode
 *
 */
 var cluster = require("cluster");
var config = require("./config.json");
process.env.NODE_ENV = config["server"]["mode"];
var logger = require("./../../Common/sources/logger");
var spellCheck;
var idCheckInterval, c_nCheckHealth = 60000,
c_sCheckWord = "color",
c_sCheckLang = 1033;
var canStartCheck = true;
var statusCheckHealth = true;
function checkHealth(worker) {
    if (!statusCheckHealth) {
        logger.error("error check health, restart!");
        worker.kill();
        return;
    }
    worker.send({
        type: "spell"
    });
    statusCheckHealth = false;
}
function endCheckHealth(msg) {
    statusCheckHealth = true;
}
var workersCount = 1;
if (cluster.isMaster) {
    logger.warn("start cluster with %s workers", workersCount);
    cluster.on("listening", function (worker) {
        if (canStartCheck) {
            canStartCheck = false;
            idCheckInterval = setInterval(function () {
                checkHealth(worker);
            },
            c_nCheckHealth);
            worker.on("message", function (msg) {
                endCheckHealth(msg);
            });
        }
    });
    for (var nIndexWorker = 0; nIndexWorker < workersCount; ++nIndexWorker) {
        var worker = cluster.fork().process;
        logger.warn("worker %s started.", worker.pid);
    }
    cluster.on("exit", function (worker) {
        logger.warn("worker %s died. restart...", worker.process.pid);
        clearInterval(idCheckInterval);
        endCheckHealth();
        canStartCheck = true;
        cluster.fork();
    });
} else {
    var express = require("express"),
    http = require("http"),
    https = require("https"),
    fs = require("fs"),
    app = express(),
    server = null;
    spellCheck = require("./spellCheck");
    logger.warn("Express server starting...");
    if (config["ssl"]) {
        var privateKey = fs.readFileSync(config["ssl"]["key"]).toString();
        var certificateKey = fs.readFileSync(config["ssl"]["cert"]).toString();
        var trustedCertificate = fs.readFileSync(config["ssl"]["ca"]).toString();
        var options = {
            key: privateKey,
            cert: certificateKey,
            ca: [trustedCertificate]
        };
        server = https.createServer(options, app);
    } else {
        server = http.createServer(app);
    }
    spellCheck.install(server, function () {
        server.listen(config["server"]["port"], function () {
            logger.warn("Express server listening on port %d in %s mode", config["server"]["port"], app.settings.env);
        });
        app.get("/index.html", function (req, res) {
            res.send("Server is functioning normally");
        });
    });
    process.on("message", function (msg) {
        if (!spellCheck) {
            return;
        }
        spellCheck.spellSuggest(msg.type, c_sCheckWord, c_sCheckLang, function (res) {
            process.send({
                type: msg.type,
                res: res
            });
        });
    });
    process.on("uncaughtException", function (err) {
        logger.error((new Date).toUTCString() + " uncaughtException:", err.message);
        logger.error(err.stack);
        logger.shutdown(function () {
            process.exit(1);
        });
    });
}