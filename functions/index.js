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

    // 通知本文を作成（予定が無い日も送る）
    const notifTitle = '明日（' + tMonth + '/' + tDay + '）の予定';
    let notifBody;
    if (tomorrowData.morning || tomorrowData.evening) {
      const parts = [];
      if (tomorrowData.morning) parts.push('朝練あり（8:00）');
      if (tomorrowData.evening) parts.push('夕練 ' + tomorrowData.evening + ' 終了');
      notifBody = parts.join(' / ');
    } else {
      notifBody = '明日の予定はありません';
    }

    // 通知の対象日（重複防止のキー）
    const targetDate = tYear + '-' + String(tMonth).padStart(2, '0') + '-' + String(tDay).padStart(2, '0');

    // 通知ONのアカウントを取得して、アカウント単位で送信
    const usersSnap = await admin.firestore().collection('users').get();
    const sends = [];

    for (const userDoc of usersSnap.docs) {
      const u   = userDoc.data();
      const uid = userDoc.id;
      if (!u.notifEnabled) continue;

      // アカウントの通知時間と現在時刻を照合
      // 「通知時刻 〜 通知時刻+60分」に入った実行だけで送る（早すぎる送信を防ぐ）
      const [h, m] = (u.notifTime || '21:00').split(':').map(Number);
      const userMin = h * 60 + m;
      let delta = currentMin - userMin;
      if (delta < 0) delta += 24 * 60;   // 日付またぎ対応
      if (delta > 60) continue;          // まだ通知時刻前 / 今サイクルの対象外

      // この対象日に既に送信済みならスキップ（重複送信を防ぐ）
      if (u.lastNotified === targetDate) continue;

      // このアカウントに紐づく全端末トークンを取得
      const tokensSnap = await admin.firestore()
        .collection('devices').where('uid', '==', uid).get();
      if (tokensSnap.empty) continue;

      const lineEnabled = !!(u.lineEnabled);
      const lineTarget  = u.lineTarget  || 'home';
      const lineGroupId = u.lineGroupId || '';
      const link = lineEnabled
        ? (lineTarget === 'group' && lineGroupId
            ? 'line://ti/g/' + lineGroupId
            : 'line://')
        : 'https://n246ra-all.github.io/bukatsu-schedule/';

      // アカウントの各端末へ送信
      const tokenSends = tokensSnap.docs.map(tokenDoc => {
        const message = {
          token: tokenDoc.id,
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
            fcmOptions: { link },
          },
        };
        return admin.messaging().send(message).catch(err => {
          console.error('Send failed:', tokenDoc.id, err.code);
          // 無効なトークンは削除
          if (err.code === 'messaging/invalid-registration-token' ||
              err.code === 'messaging/registration-token-not-registered') {
            return admin.firestore().collection('devices').doc(tokenDoc.id).delete();
          }
        });
      });

      // 送信後、このアカウントを「この対象日は送信済み」と記録（重複防止）
      sends.push(
        Promise.all(tokenSends).then(() =>
          admin.firestore().collection('users').doc(uid)
            .update({ lastNotified: targetDate })
        )
      );
    }

    await Promise.all(sends);
    console.log('Sent notifications to ' + sends.length + ' accounts for ' + tMonth + '/' + tDay);
    return null;
  });
