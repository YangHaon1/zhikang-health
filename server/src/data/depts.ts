/**
 * 部门数据（用户管理页左侧部门树 + 归属部门级联选择器）。
 *
 * B8 由改造前的 mock 数据原样迁移：结构、id 与层级不变（前端 `handleTree` 依赖 parentId），
 * 仅把原来的 faker 随机负责人/邮箱换成固定值 —— 服务端种子数据要可复现，不引入随机。
 */
export interface DeptRow {
  id: number;
  name: string;
  parentId: number;
  sort: number;
  phone: string;
  principal: string;
  email: string;
  /** 1 启用 0 停用 */
  status: number;
  /** 1 公司 2 分公司 3 部门 */
  type: number;
  createTime: number;
  remark: string;
}

const CREATE_TIME = 1605456000000;
const REMARK = "这里是备注信息这里是备注信息这里是备注信息这里是备注信息";

export const depts: Array<DeptRow> = [
  {
    id: 100,
    name: "杭州总公司",
    parentId: 0,
    sort: 0,
    phone: "15888888888",
    principal: "张伟",
    email: "zhangwei@zhikang.local",
    status: 1,
    type: 1,
    createTime: CREATE_TIME,
    remark: REMARK
  },
  {
    id: 101,
    name: "郑州分公司",
    parentId: 100,
    sort: 1,
    phone: "15888888888",
    principal: "李强",
    email: "liqiang@zhikang.local",
    status: 1,
    type: 2,
    createTime: CREATE_TIME,
    remark: REMARK
  },
  {
    id: 102,
    name: "深圳分公司",
    parentId: 100,
    sort: 2,
    phone: "15888888888",
    principal: "王芳",
    email: "wangfang@zhikang.local",
    status: 1,
    type: 2,
    createTime: CREATE_TIME,
    remark: REMARK
  },
  {
    id: 103,
    name: "研发部门",
    parentId: 101,
    sort: 1,
    phone: "15888888888",
    principal: "刘洋",
    email: "liuyang@zhikang.local",
    status: 1,
    type: 3,
    createTime: CREATE_TIME,
    remark: REMARK
  },
  {
    id: 104,
    name: "市场部门",
    parentId: 101,
    sort: 2,
    phone: "15888888888",
    principal: "陈静",
    email: "chenjing@zhikang.local",
    status: 1,
    type: 3,
    createTime: CREATE_TIME,
    remark: REMARK
  },
  {
    id: 105,
    name: "测试部门",
    parentId: 101,
    sort: 3,
    phone: "15888888888",
    principal: "赵敏",
    email: "zhaomin@zhikang.local",
    status: 0,
    type: 3,
    createTime: CREATE_TIME,
    remark: REMARK
  },
  {
    id: 106,
    name: "财务部门",
    parentId: 101,
    sort: 4,
    phone: "15888888888",
    principal: "孙磊",
    email: "sunlei@zhikang.local",
    status: 1,
    type: 3,
    createTime: CREATE_TIME,
    remark: REMARK
  },
  {
    id: 107,
    name: "运维部门",
    parentId: 101,
    sort: 5,
    phone: "15888888888",
    principal: "周涛",
    email: "zhoutao@zhikang.local",
    status: 0,
    type: 3,
    createTime: CREATE_TIME,
    remark: REMARK
  },
  {
    id: 108,
    name: "市场部门",
    parentId: 102,
    sort: 1,
    phone: "15888888888",
    principal: "吴磊",
    email: "wulei@zhikang.local",
    status: 1,
    type: 3,
    createTime: CREATE_TIME,
    remark: REMARK
  },
  {
    id: 109,
    name: "财务部门",
    parentId: 102,
    sort: 2,
    phone: "15888888888",
    principal: "郑爽",
    email: "zhengshuang@zhikang.local",
    status: 1,
    type: 3,
    createTime: CREATE_TIME,
    remark: REMARK
  }
];

/** 部门 id → 名称（用户列表的 `dept.name` 列用） */
export function deptName(id: number): string {
  return depts.find(d => d.id === id)?.name ?? "";
}
