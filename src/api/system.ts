import { http } from "@/utils/http";

type Result = {
  code: number;
  message: string;
  data?: Array<any>;
};

type ResultTable = {
  code: number;
  message: string;
  data?: {
    /** 列表数据 */
    list: Array<any>;
    /** 总条目数 */
    total?: number;
    /** 每页显示条目个数 */
    pageSize?: number;
    /** 当前页数 */
    currentPage?: number;
  };
};

/** 用户管理-查询参数 */
export type UserQuery = {
  /** 左侧部门树选中的部门 id */
  deptId?: number | string;
  username?: string;
  phone?: string;
  status?: number | string;
  currentPage?: number;
  pageSize?: number;
};

/** 用户管理-新增/修改提交的数据 */
export type UserForm = {
  username?: string;
  password?: string;
  nickname?: string;
  phone?: string | number;
  email?: string;
  sex?: number | string;
  status?: number;
  /** 归属部门 id */
  deptId?: number;
  remark?: string;
  avatar?: string;
  /** 角色 id 列表（分配角色） */
  roleIds?: Array<number>;
};

/** 获取系统管理-用户管理列表 */
export const getUserList = (data?: UserQuery) => {
  return http.request<ResultTable>("get", "/api/user", { params: data });
};

/** 系统管理-用户管理-新增用户 */
export const addUser = (data: UserForm) => {
  return http.request<Result>("post", "/api/user", { data });
};

/** 系统管理-用户管理-修改用户（改密码时服务端会 bcrypt 重新哈希） */
export const updateUser = (id: number, data: UserForm) => {
  return http.request<Result>("put", `/api/user/${id}`, { data });
};

/** 系统管理-用户管理-删除用户 */
export const deleteUser = (id: number) => {
  return http.request<Result>("delete", `/api/user/${id}`);
};

/** 系统管理-用户管理-获取所有角色列表 */
export const getAllRoleList = () => {
  return http.request<Result>("get", "/api/list-all-role");
};

/** 系统管理-用户管理-根据userId，获取对应角色id列表（userId：用户id） */
export const getRoleIds = (data?: object) => {
  return http.request<Result>("post", "/api/list-role-ids", { data });
};

/** 获取系统管理-部门管理列表 */
export const getDeptList = (data?: object) => {
  return http.request<Result>("post", "/api/dept", { data });
};
