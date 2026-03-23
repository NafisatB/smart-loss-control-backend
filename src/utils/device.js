// utils/device.js

exports.getDeviceInfo = (req) => {
  const ua = req.headers['user-agent'] || '';

  if (/android/i.test(ua)) return 'Android Device';
  if (/iphone|ipad|ipod/i.test(ua)) return 'iPhone / iPad';
  if (/windows/i.test(ua)) return 'Windows PC';
  if (/mac/i.test(ua)) return 'MacBook';
  if (/linux/i.test(ua)) return 'Linux PC';

  return 'Unknown Device';
};