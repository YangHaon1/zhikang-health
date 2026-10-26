/**
 * 部门树（静态配置）。
 *
 * 与种子账号 dept_id 对齐：admin → 103（运维部），common → 105（测试部）。
 * 用户管理页左侧树 / 列表行 `dept` 字段都读这一份；库内只存 dept_id。
 */

export interface DeptNode {
  id: number;
  name: string;
  parentId: number;
  sort?: number;
  children?: DeptNode[];
}

/** 部门树（供 GET/POST /api/dept 返回） */
export const DEPT_TREE: DeptNode[] = [
  {
    id: 100,
    name: "华东分部",
    parentId: 0,
    sort: 1,
    children: [
      { id: 101, name: "研发部", parentId: 100, sort: 1 },
      { id: 102, name: "市场部", parentId: 100, sort: 2 },
      { id: 103, name: "运维部", parentId: 100, sort: 3 },
      { id: 104, name: "财务部", parentId: 100, sort: 4 },
      { id: 105, name: "测试部", parentId: 100, sort: 5 }
    ]
  },
  {
    id: 200,
    name: "华南分部",
    parentId: 0,
    sort: 2,
    children: [
      { id: 201, name: "华南研发", parentId: 200, sort: 1 },
      { id: 202, name: "华南市场", parentId: 200, sort: 2 }
    ]
  }
];

/** 按 id 查找部门（扁平），找不到返回 null */
export function findDept(
  id: number | null | undefined
): { id: number; name: string } | null {
  if (id == null || !Number.isFinite(Number(id)) || Number(id) <= 0) {
    return null;
  }
  const target = Number(id);
  const walk = (nodes: DeptNode[]): { id: number; name: string } | null => {
    for (const n of nodes) {
      if (n.id === target) return { id: n.id, name: n.name };
      if (n.children?.length) {
        const hit = walk(n.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(DEPT_TREE);
}
