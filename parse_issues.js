const fs = require('fs');
const data = JSON.parse(fs.readFileSync('C:/Users/Administrator/.gemini/antigravity-ide/brain/2192a41b-ccb7-4939-ad79-37ca31e92606/.system_generated/steps/569/output.txt', 'utf8'));
data.forEach(i => {
    const ms = i.projectMilestone ? i.projectMilestone.name : 'No Milestone';
    console.log(`${i.identifier}: [${i.state.name}] ${i.title} (${ms})`);
});
