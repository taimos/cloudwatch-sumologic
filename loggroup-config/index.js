const AWS = require('aws-sdk');
const LOGS = new AWS.CloudWatchLogs({region: process.env.AWS_REGION});

const listLogGroups = () => {
  'use strict';
  // TODO recursion
  return LOGS.describeLogGroups({}).promise().then(res => {
    return res.logGroups.map(group => {
      return {
        name: group.logGroupName,
        retention: group.retentionInDays
      };
    });
  });
};

const filterLogGroups = groups => {
  'use strict';
  return Promise.all(groups.map(group => {
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        LOGS.describeSubscriptionFilters({logGroupName: group.name}).promise()
          .then(res => {
            resolve({
              name: group.name,
              retention: group.retention,
              subscriptions: res.subscriptionFilters.map(filter => filter.destinationArn)
            });
          }, reject);
      }, (groups.length / 3) * 1000);
    });
  })).then(groups => {
    return groups
      .filter(grp => grp.subscriptions.length === 0)
      .filter(grp => grp.name !== `/aws/lambda/${process.env.FORWARDER_FUNCTION_NAME}`);
  });
};

const subscribeForwarder = groups => {
  'use strict';
  return Promise.all(groups.map(group => {
    return LOGS.putSubscriptionFilter({
      logGroupName: group.name,
      filterName: 'SumoLogic',
      filterPattern: '',
      destinationArn: process.env.FORWARDER_FUNCTION_ARN
    }).promise().then(() => group);
  }));
};

const filterByRetention = groups => {
  'use strict';
  return groups.filter(group => !group.retention);
};

const configureRetention = groups => {
  'use strict';
  return Promise.all(groups.map(group => {
    return LOGS.putRetentionPolicy({
      logGroupName: group.name,
      retentionInDays: 3
    }).promise().then(() => group);
  }));
};

const printGroups = groups => {
  'use strict';
  console.log(groups);
  return groups;
};

exports.handler = (event, context, callback) => {
  'use strict';
  
  listLogGroups()
    .then(filterLogGroups)
    .then(printGroups)
    .then(subscribeForwarder)
    .then(filterByRetention)
    .then(printGroups)
    .then(configureRetention)
    .then(() => {
      callback(null, 'Successfully configured log forwarding');
    })
    .catch(err => {
      console.log('ERROR: ', err, err.stack);
      callback(err);
    });
};