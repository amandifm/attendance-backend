const { Expo } = require("expo-server-sdk");

const expo = new Expo();

async function sendNotification(token, title, body, data = {}) {
  const messages = [
    {
      to: token,
      sound: "default",
      title,
      body,
      data,
    },
  ];

  return expo.sendPushNotificationsAsync(messages);
}

module.exports = {
  sendNotification,
};