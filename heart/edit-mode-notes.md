# 用编辑模式生成爱心：操作记录

本作业的初始噪声布局是通过本项目 v0.4.0 的**编辑模式 HTTP API** 实际提交到
60 × 54 的 B3/S23 世界里的，然后步进 1 代并逐格核对终末爱心。

## 操作步骤

| 步骤 | 请求 | 结果 |
|---|---|---|
| 1 | `POST /api/sessions`，`{"width":60,"height":54,"history":false}` | 创建会话 `s1` |
| 2 | `POST /api/edit/enter?session=s1` | `editMode: true`，`version: 0`，`hash: bce0fb7f6247c8e6fc1b9deb0b7ee6ce4460dcf2ab644cc49e15627b20fdf164` |
| 3 | `POST /api/edit/transaction?session=s1`，`{txId:"heart-seed", baseVersion:0, baseHash:<上一步>, author:"assignment", ops:[{kind:"set", alive:true, cells:<initial_cells.json>}]}` | `version: 1`，`hash: 963a6547ec0653a994a1c7231c62e9a94509418f9a82e312d61b11b17f4152f3`，`born: 1226`，`died: 0` |
| 4 | `POST /api/edit/leave?session=s1` | `editMode: false`，`resumed: false`（世界保持暂停） |
| 5 | `POST /api/command?session=s1`，`{"cmd":"step","count":1}` | `generation: 1` |
| 6 | `GET /api/state?session=s1` | `population: 364` |
| 7 | `GET /api/cells?session=s1`（解码 export） | 364 个活细胞，与 `heart_cells.json` **逐格一致**（`equalsHeart: true`） |

完整的机器可读记录见 `edit_mode_record.json`。

## 结论

- 事务提交的初始状态：1226 个活细胞的噪声图案；
- 第 1 代：364 个活细胞，与预计算的爱心逐格一致；
- 爱心是静物，所以第 2 代及以后保持不变；
- 编辑模式进入时暂停世界、退出后保持暂停，步进与核对没有其他写入者干扰；
- 初始图看不出爱心，终末图是完整爱心，两图明显不同。
