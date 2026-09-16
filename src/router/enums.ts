// 菜单 rank 抽离在此集中维护

const home = 0, // 平台规定只有 home 路由的 rank 才能为 0 ，所以后端在返回 rank 的时候需要从非 0 开始
  healthProfile = 1,
  healthRecords = 2,
  healthTrend = 3,
  healthReport = 4,
  healthChat = 5,
  healthImport = 6,
  systemUser = 7;

export {
  home,
  healthProfile,
  healthRecords,
  healthTrend,
  healthReport,
  healthChat,
  healthImport,
  systemUser
};
