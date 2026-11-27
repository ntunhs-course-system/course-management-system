require('dotenv').config({ path: require('node:path').join(__dirname, '.env'), quiet: true });

const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;

createApp().listen(PORT, () => {
  console.log(`後端已啟動：http://localhost:${PORT}`);
});
