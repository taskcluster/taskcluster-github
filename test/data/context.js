// the lines below are a draft. These will not be hard coded,
// I plan to figure out the data flow later, after I got intree
// creating tasks correctly and at least one test passing
const event = require('./events/push.event.json');

module.exports = {
  tasks_for: 'github-push', // webhook payload
  event,
};