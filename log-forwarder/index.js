//////////////////////////////////////////////////////////////////////////////////////////////
//                         Based on CloudWatch Logs to SumoLogic                            //
//     https://github.com/SumoLogic/sumologic-aws-lambda/tree/master/cloudwatchlogs         //
//                                                                                          //
//    YOU MUST CREATE A SUMO LOGIC ENDPOINT AND PASTE IN ENVIRONMENTAL VARIABLES BELOW      //
// https://help.sumologic.com/Send_Data/Sources/02Sources_for_Hosted_Collectors/HTTP_Source //
//////////////////////////////////////////////////////////////////////////////////////////////

// SumoLogic Endpoint to post logs
const SumoURL = process.env.SUMO_ENDPOINT;

// The following parameters override the sourceCategoryOverride, sourceHostOverride and sourceNameOverride metadata fields within SumoLogic.
// Not these can also be overridden via json within the message payload. See the README for more information.
const sourceCategoryOverride = process.env.SOURCE_CATEGORY_OVERRIDE || 'none';  // If none sourceCategoryOverride will not be overridden
const sourceHostOverride = process.env.SOURCE_HOST_OVERRIDE || 'none';          // If none sourceHostOverride will not be set to the name of the logGroup
const sourceNameOverride = process.env.SOURCE_NAME_OVERRIDE || 'none';          // If none sourceNameOverride will not be set to the name of the logStream

// CloudWatch logs encoding
const encoding = process.env.ENCODING || 'utf-8';  // default is utf-8

// Include logStream and logGroup as json fields within the message. Required for SumoLogic AWS Lambda App
const includeLogInfo = true;  // default is true

// Regex used to detect logs coming from lambda functions.
// The regex will parse out the requestID and strip the timestamp
// Example: 2016-11-10T23:11:54.523Z	108af3bb-a79b-11e6-8bd7-91c363cc05d9    some message
const consoleFormatRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\t(\w+?-\w+?-\w+?-\w+?-\w+)\t/;

// Used to extract RequestID
const requestIdRegex = /(?:RequestId:|Z)\s+([\w\d-]+)/;

const https = require('https');
const zlib = require('zlib');
const url = require('url');


function sumoMetaKey(awslogsData, message) {
  'use strict';
  
  let sourceCategory = '';
  let sourceName = '';
  let sourceHost = '';
  
  if (sourceCategoryOverride !== null && sourceCategoryOverride !== '' && sourceCategoryOverride !== 'none') {
    sourceCategory = sourceCategoryOverride;
  }
  
  if (sourceHostOverride !== null && sourceHostOverride !== '' && sourceHostOverride !== 'none') {
    sourceHost = sourceHostOverride;
  } else {
    sourceHost = awslogsData.logGroup;
  }
  
  if (sourceNameOverride !== null && sourceNameOverride !== '' && sourceNameOverride !== 'none') {
    sourceName = sourceNameOverride;
  } else {
    sourceName = awslogsData.logStream;
  }
  
  // Ability to override metadata within the message
  // Useful within Lambda function console.log to dynamically set metadata fields within SumoLogic.
  if (message.hasOwnProperty('_sumo_metadata')) {
    let metadataOverride = message._sumo_metadata;
    if (metadataOverride.category) {
      sourceCategory = metadataOverride.category;
    }
    if (metadataOverride.host) {
      sourceHost = metadataOverride.host;
    }
    if (metadataOverride.source) {
      sourceName = metadataOverride.source;
    }
    delete message._sumo_metadata;
  }
  return sourceName + ':' + sourceCategory + ':' + sourceHost;
  
}

function postToSumo(context, messages) {
  'use strict';
  
  let messagesTotal = Object.keys(messages).length;
  let messagesSent = 0;
  let messageErrors = [];
  
  let urlObject = url.parse(SumoURL);
  let options = {
    'hostname': urlObject.hostname,
    'path': urlObject.pathname,
    'method': 'POST'
  };
  
  const finalizeContext = () => {
    let total = messagesSent + messageErrors.length;
    if (total === messagesTotal) {
      console.log('messagesSent: ' + messagesSent + ' messagesErrors: ' + messageErrors.length);
      if (messageErrors.length > 0) {
        context.fail('errors: ' + messageErrors);
      } else {
        context.succeed();
      }
    }
  };
  
  
  Object.keys(messages).forEach(key => {
    let headerArray = key.split(':');
    
    options.headers = {
      'X-Sumo-Name': headerArray[0],
      'X-Sumo-Category': headerArray[1],
      'X-Sumo-Host': headerArray[2]
    };
    
    let req = https.request(options, res => {
      res.setEncoding('utf8');
      res.on('data', () => {
      });
      res.on('end', () => {
        if (res.statusCode === 200) {
          messagesSent++;
        } else {
          messageErrors.push('HTTP Return code ' + res.statusCode);
        }
        finalizeContext();
      });
    });
    
    req.on('error', e => {
      messageErrors.push(e.message);
      finalizeContext();
    });
    
    for (let i = 0; i < messages[key].length; i++) {
      req.write(JSON.stringify(messages[key][i]) + '\n');
    }
    req.end();
  });
}


exports.handler = (event, context) => {
  'use strict';
  
  // Used to hold chunks of messages to post to SumoLogic
  let messageList = {};
  
  // Validate URL has been set
  let urlObject = url.parse(SumoURL);
  if (urlObject.protocol !== 'https:' || urlObject.host === null || urlObject.path === null) {
    context.fail('Invalid SUMO_ENDPOINT environment variable: ' + SumoURL);
  }
  
  let zippedInput = new Buffer(event.awslogs.data, 'base64');
  
  zlib.gunzip(zippedInput, function (e, buffer) {
    if (e) {
      context.fail(e);
    }
  
    let awslogsData = JSON.parse(buffer.toString(encoding));
    
    if (awslogsData.messageType === 'CONTROL_MESSAGE') {
      console.log('Control message');
      context.succeed('Success');
    }
  
    let lastRequestID = null;
    
    console.log('Log events: ' + awslogsData.logEvents.length);
    
    // Chunk log events before posting to SumoLogic
    awslogsData.logEvents.forEach(log => {
      
      // Remove any trailing \n
      log.message = log.message.replace(/\n$/, '');
      
      // Try extract requestID
      let requestId = requestIdRegex.exec(log.message);
      if (requestId !== null) {
        lastRequestID = requestId[1];
      }
      
      // Attempt to detect console log and auto extract requestID and message
      let consoleLog = consoleFormatRegex.exec(log.message);
      if (consoleLog !== null) {
        lastRequestID = consoleLog[1];
        log.message = log.message.substring(consoleLog[0].length);
      }
      
      // Auto detect if message is json
      try {
        log.message = JSON.parse(log.message);
      } catch (err) {
        // Do nothing, leave as text
        log.message.trim();
      }
      
      // delete id as it's not very useful
      delete log.id;
      
      if (includeLogInfo) {
        log.logStream = awslogsData.logStream;
        log.logGroup = awslogsData.logGroup;
      }
      
      if (lastRequestID) {
        log.requestID = lastRequestID;
      }
  
      let metadataKey = sumoMetaKey(awslogsData, log.message);
      
      if (metadataKey in messageList) {
        messageList[metadataKey].push(log);
      } else {
        messageList[metadataKey] = [log];
      }
    });
    
    // Push messages to Sumo
    postToSumo(context, messageList);
  });
};