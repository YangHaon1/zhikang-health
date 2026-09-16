/** users 表行结构（与 server/src/db.ts 建表语句一致） */
export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  nickname: string;
  email: string;
  phone: string;
  description: string;
  avatar: string;
  roles: string;
  create_time: string;
}

/** 数据库里 roles 以逗号分隔存储（如 "admin"），统一拆成数组使用 */
export function splitRoles(roles: string): Array<string> {
  return (roles ?? "")
    .split(",")
    .map(r => r.trim())
    .filter(Boolean);
}
