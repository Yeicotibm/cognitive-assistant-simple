/**
 * Copyright 2015 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

 /**
  * Modified by ybonilla@co.ibm.com
  * date: 2018-05-07
  */

'use strict';

var express = require('express'); // app server
var bodyParser = require('body-parser'); // parser for post requests
var watson = require('watson-developer-cloud'); // watson sdk

var app = express();

// Vars added by Yeicot
var dbtmp = []; // Save locally data

var _add = false;
var _qryEvent = false;
var _qryDate = false;

const DATE_INI_VALUE = "1900-01-01";
var dtBegin = DATE_INI_VALUE;

// Bootstrap application settings
app.use(express.static('./public')); // load UI from public folder
app.use(bodyParser.json());

// Create the service wrapper

var assistant = new watson.AssistantV1({
  // If unspecified here, the ASSISTANT_USERNAME and ASSISTANT_PASSWORD env properties will be checked
  // After that, the SDK will fall back to the bluemix-provided VCAP_SERVICES environment property
  username: process.env.ASSISTANT_USERNAME || '<username>',
  password: process.env.ASSISTANT_PASSWORD || '<password>',
  version: '2018-05-07'
});

// Endpoint to be call from the client side
app.post('/api/message', function(req, res) {
  var workspace = process.env.WORKSPACE_ID || '<workspace-id>';
  if (!workspace || workspace === '<workspace-id>') {
    return res.json({
      'output': {
        'text': 'The app has not been configured with a <b>WORKSPACE_ID</b> environment variable. Please refer to the ' + '<a href="https://github.com/watson-developer-cloud/assistant-simple">README</a> documentation on how to set this variable. <br>' + 'Once a workspace has been defined the intents may be imported from ' + '<a href="https://github.com/watson-developer-cloud/assistant-simple/blob/master/training/car_workspace.json">here</a> in order to get a working application.'
      }
    });
  }
  var payload = {
    workspace_id: workspace,
    context: req.body.context || {},
    input: req.body.input || {}
  };

  // Send the input to the assistant service
  assistant.message(payload, function(err, data) {
    if (err) {
      return res.status(err.code || 500).json(err);
    }

    // Modified by Yeicot
    let up = updateMessage(payload, data);

    if( typeof( data.context.eventName ) == "string" &&
    typeof( data.context.location ) == "string" &&
    typeof( data.context.eventDate ) == "string" &&
    typeof( data.context.startTime ) == "string" &&
    typeof( data.context.eventEndDate ) == "string" &&
    typeof( data.context.eventContact ) == "string" )
    {
      // We are adding temporally the data
      dbtmp.push(
        {
        "eventName" : data.context.eventName,
        "location" : data.context.location,
        "eventDate" : data.context.eventDate,
        "startTime" : data.context.startTime,
        "eventEndDate" : data.context.eventEndDate,
        "eventContact" : data.context.eventContact
        }
      );
      // this flag indicate us that we have to add information
      _add = true;
    }

    if( typeof( data.context.queryPredicate ) == "string" ){
      if( data.context.queryPredicate == "identifier"){
        _qryEvent = true;
      }
      if( data.context.queryPredicate == "date"){
        _qryDate = true;
      }
    }

    if( _qryDate ){
      if(typeof( data.context.eventDateBegin ) == "string" ){
        dtBegin = data.context.eventDateBegin ;
      }
    }

    if( typeof( data.output.deleted) == "string" ){
      // Add Info to our db
      if( _add ){
        let theLast = dbtmp.length;
        dbtmp[theLast-1]["endTime"] = data.input.text;
        console.log( dbtmp );
        up["dblocal"] = dbtmp;
        console.log( "Reiniciar elementos" );
        _add = false;
      }

      // Query by identifier
      if ( _qryEvent ){
        var d = queryByEventName(data.input.text);

        if( d.length > 0 ){
          let htmlR = htmlMk(d);
          up.output.text = htmlR.join("<br />");
        }else{
          up.output.text = "Sorry, I can not find data.";
        }

        _qryEvent = false;
      }
      
      // Query by date
      if ( _qryDate ){
        var beg = dtBegin;
        var end = data.input.text;

        var d = queryByEventDate(beg, end);
        if( d.length > 0 ){
          let htmlR = htmlMk(d);
          up.output.text = htmlR.join("<br />");
        }else{
          up.output.text = "Sorry, I can not find data.";
        }
        dtBegin = DATE_INI_VALUE;
        _qryDate = false;
      }

    }

    return res.json(up);
  });
});

/**
 * Updates the response text using the intent confidence
 * @param  {Object} input The request to the Assistant service
 * @param  {Object} response The response from the Assistant service
 * @return {Object}          The response with the updated message
 */
function updateMessage(input, response) {
  var responseText = null;
  if (!response.output) {
    response.output = {};
  } else {
    return response;
  }
  if (response.intents && response.intents[0]) {
    var intent = response.intents[0];
    // Depending on the confidence of the response the app can return different messages.
    // The confidence will vary depending on how well the system is trained. The service will always try to assign
    // a class/intent to the input. If the confidence is low, then it suggests the service is unsure of the
    // user's intent . In these cases it is usually best to return a disambiguation message
    // ('I did not understand your intent, please rephrase your question', etc..)
    if (intent.confidence >= 0.75) {
      responseText = 'I understood your intent was ' + intent.intent;
    } else if (intent.confidence >= 0.5) {
      responseText = 'I think your intent was ' + intent.intent;
    } else {
      responseText = 'I did not understand your intent';
    }
  }
  response.output.text = responseText;
  return response;
}

/**
 * Makes html template for the JSON results
 * @param {String} d Data result from the Watson Assistent
 * @returns string  The final html
 */
function htmlMk(d){
  var r1 = [];
  for(var id in d){
    var d1 = d[id];
    for(var idD in d1){
      r1.push(idD + " : " + d1[idD]);
    }
    r1.push("<hr />");
  }
  return r1;
}

/**
 * Query data by event name
 * @param {String} name The event name
 * @returns {Object}    The matches
 */
function queryByEventName(name){
  var results = [];
  dbtmp.forEach(el => {
    console.log( el.eventName + " == " + name );
    if(el.eventName == name){
      console.log(el);
      results.push( el );
    }
  });
  return results;
}

/**
 * Query data by event date
 * @param {String} be The event's begin date
 * @param {String} en The event's end date
 * @returns {Object}    The matches
 */
function queryByEventDate(be, en){
  var results = [];
  dbtmp.forEach(el => {
    
    let beg = new Date( be + " 00:00:00" );
    let end = new Date( en + " 23:59:59" );
    let sBeg = new Date( el.eventDate + " 00:00:00" );
    let sEnd = new Date( el.eventEndDate + " 23:59:59" );
    if(sBeg >= beg && sEnd <= end){
      console.log(el);
      results.push( el );
    }
  });
  return results;
}

module.exports = app;
