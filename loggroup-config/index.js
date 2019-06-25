const AWS = require('aws-sdk');
const LOGS = new AWS.CloudWatchLogs({region: process.env.AWS_REGION, maxRetries: 10});

const listLogGroups = async () => {
  'use strict';
  let groups = [];
  let res;
  do {
    res = await LOGS.describeLogGroups({nextToken: res ? res.nextToken : undefined}).promise();
    res.logGroups.forEach(group => {
      groups.push({
        name: group.logGroupName,
        retention: group.retentionInDays
      });
    });
  } while (res.nextToken);
  return groups;
};

const filterLogGroups = groups => {
  'use strict';
  return Promise.all(groups.map(group => {
    return LOGS.describeSubscriptionFilters({logGroupName: group.name}).promise()
      .then(res => {
        return {
          name: group.name,
          retention: group.retention,
          subscriptions: res.subscriptionFilters.map(filter => filter.destinationArn)
        };
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
