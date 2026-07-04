const functions = require('firebase-functions');
const admin     = require('firebase-admin');
admin.initializeApp();

// 毎日30分ごとに実行して、各端末の通知時間に合わせて前日通知を送る
exports.sendDailyNotifications = functions
  .region('asia-northeast1')
  .pubsub.schedule('every 30 minutes')
  .timeZone('Asia/Tokyo')
  .onRun(async () => {
    const now = new Date();
    // JST に変換
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentH   = jst.getUTCHours();
    const currentM   = jst.getUTCMinutes();
    const currentMin = currentH * 60 + currentM;

    // 翌日の日付（JST）
    const tomorrow = new Date(jst);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tYear  = tomorrow.getUTCFullYear();
    const tMonth = tomorrow.getUTCMonth() + 1;
    const tDay   = tomorrow.getUTCDate();

    // 翌日のスケジュールを取得
    const docId = tYear + '-' + String(tMonth).padStart(2, '0');
    const scheduleSnap = await admin.firestore()
      .collection('schedules').doc(docId).get();
    const days = scheduleSnap.exists ? (scheduleSnap.data().days || {}) : {};
    const tomorrowData = days[String(tDay)] || { morning: false, evening: null };

    // 翌日に予定がなければ終了
    if (!tomorrowData.morning && !tomorrowData.evening) {
      console.log('No schedule tomorrow, skipping.');
      return null;
    }

    // 通知本文を作成
    const parts = [];
    if (tomorrowData.morning) parts.push('朝練あり（8:00）');
    if (tomorrowData.evening) parts.push('夕練 ' + tomorrowData.evening + ' 終了');
    const notifBody = parts.join(' / ');
    const notifTitle = '明日（' + tMonth + '/' + tDay + '）の予定';

    // 通知ONの端末を取得して送信
    const devicesSnap = await admin.firestore().collection('devices').get();
    const sends = [];

    devicesSnap.forEach(doc => {
      const device = doc.data();
      if (!device.notifEnabled) return;

      // 端末の通知時間と現在時刻を照合（±30分以内）
      const [h, m] = (device.notifTime || '21:00').split(':').map(Number);
      const deviceMin = h * 60 + m;
      if (Math.abs(deviceMin - currentMin) > 30) return;

      const lineEnabled = !!(device.lineEnabled);
      const lineTarget  = device.lineTarget  || 'home';
      const lineGroupId = device.lineGroupId || '';

      const message = {
        token: doc.id,
        notification: { title: notifTitle, body: notifBody },
        data: {
          lineEnabled:  String(lineEnabled),
          lineTarget:   lineTarget,
          lineGroupId:  lineGroupId,
        },
        webpush: {
          notification: {
            icon:  'https://n246ra-all.github.io/bukatsu-schedule/icon-192.png',
            badge: 'https://n246ra-all.github.io/bukatsu-schedule/icon-192.png',
          },
          fcmOptions: {
            link: lineEnabled
              ? (lineTarget === 'group' && lineGroupId
                  ? 'line://ti/g/' + lineGroupId
                  : 'line://')
              : 'https://n246ra-all.github.io/bukatsu-schedule/',
          },
        },
      };

      sends.push(
        admin.messaging().send(message).catch(err => {
          console.error('Send failed:', doc.id, err.code);
          // 無効なトークンは削除
          if (err.code === 'messaging/invalid-registration-token' ||
              err.code === 'messaging/registration-token-not-registered') {
            return admin.firestore().collection('devices').doc(doc.id).delete();
          }
        })
      );
    });

    await Promise.all(sends);
    console.log('Sent ' + sends.length + ' notifications for ' + tMonth + '/' + tDay);
    return null;
  });
