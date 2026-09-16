/**
 * 服务端版菜单权限过滤，逻辑对齐前端 src/router/utils.ts 的
 * filterNoPermissionTree / filterChildrenTree，保证前后端过滤口径一致。
 */

interface RouteNode {
  path: string;
  name?: string;
  component?: string;
  meta?: { roles?: Array<string>; [key: string]: unknown };
  children?: Array<RouteNode>;
}

/** 判断两个数组彼此是否存在相同值；任一侧不是数组时视为放行 */
function isOneOfArray(a: Array<string> | undefined, b: Array<string>): boolean {
  return Array.isArray(a) && Array.isArray(b)
    ? a.some(v => b.includes(v))
    : true;
}

/** 过滤 children 长度为 0 的目录（目录下无可见菜单时不展示该目录） */
function filterChildrenTree(data: Array<RouteNode>): Array<RouteNode> {
  const newTree = data.filter(v => v?.children?.length !== 0);
  newTree.forEach(
    v => v.children && (v.children = filterChildrenTree(v.children))
  );
  return newTree;
}

/** 按角色过滤无权限菜单 */
export function filterNoPermissionTree(
  data: Array<RouteNode>,
  currentRoles: Array<string>
): Array<RouteNode> {
  const newTree = structuredClone(data).filter(v =>
    isOneOfArray(v.meta?.roles, currentRoles)
  );
  newTree.forEach(
    v =>
      v.children &&
      (v.children = filterNoPermissionTree(v.children, currentRoles))
  );
  return filterChildrenTree(newTree);
}
