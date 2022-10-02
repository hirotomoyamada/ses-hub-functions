import { Timestamp } from '@google-cloud/firestore';
import * as functions from 'firebase-functions';
import * as Firestore from '../../types/firestore';

export const admin = (
  action: string,
  type: string,
  name: string,
  _start: Timestamp,
  _end: Timestamp,
  users: Firestore.Company[],
): string => {
  const user = users[0];

  const start = _start.toDate();
  const end = _end.toDate();

  return `
以下のユーザーがを${
    type === 'plan' ? 'プラン' : 'オプション'
  }を${action}しました。

【${type === 'plan' ? 'プラン' : 'オプション'}】
名前：
${name} (${user.type === 'individual' ? '個人' : '法人'})

開始：
${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日

終了：
${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日

【ユーザー】
会社名：
${user.profile.name}

担当者名：
${user.profile.person}

電話番号：
${user.profile.tel ? user.profile.tel : '記入無し'}

メールアドレス：
${user.profile.email}

SES_HUB 管理画面
URL : ${functions.config().admin.url}
`;
};
