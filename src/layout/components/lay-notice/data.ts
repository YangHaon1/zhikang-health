import { $t } from "@/plugins/i18n";

export interface ListItem {
  avatar: string;
  title: string;
  datetime: string;
  type: string;
  description: string;
  status?: "primary" | "success" | "warning" | "info" | "danger";
  extra?: string;
}

export interface TabItem {
  key: string;
  name: string;
  list: ListItem[];
  emptyText: string;
}

export const noticesData: TabItem[] = [
  {
    key: "1",
    name: $t("status.pureNotify"),
    list: [],
    emptyText: $t("status.pureNoNotify")
  },
  {
    key: "2",
    name: $t("status.pureMessage"),
    list: [
      {
        avatar: "",
        title: "健康提醒",
        description: "您的血压已连续 3 天超过 140/90，建议及时就医复查。",
        datetime: "今天",
        type: "2",
        status: "danger"
      },
      {
        avatar: "",
        title: "报告生成",
        description: "您最近一次健康风险评估报告已生成，可前往查看。",
        datetime: "昨天",
        type: "2"
      },
      {
        avatar: "",
        title: "数据导入",
        description: "管理员已完成一批健康数据的批量导入，共 30 条记录。",
        datetime: "3 天前",
        type: "2"
      }
    ],
    emptyText: $t("status.pureNoMessage")
  },
  {
    key: "3",
    name: $t("status.pureTodo"),
    list: [
      {
        avatar: "",
        title: "完善健康档案",
        description: "您的身高、体重等基础信息尚未填写，会影响 BMI 评估",
        datetime: "",
        extra: "待处理",
        status: "warning",
        type: "3"
      },
      {
        avatar: "",
        title: "定期监测",
        description: "建议每周至少测量 2 次血压并录入系统，保持数据连续",
        datetime: "",
        extra: "进行中",
        status: "info",
        type: "3"
      },
      {
        avatar: "",
        title: "复查提醒",
        description: "空腹血糖连续异常，建议 2 周内完成糖化血红蛋白检查",
        datetime: "",
        extra: "未开始",
        status: "danger",
        type: "3"
      }
    ],
    emptyText: $t("status.pureNoTodo")
  }
];
