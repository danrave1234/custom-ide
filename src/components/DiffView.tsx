import { useMemo } from "react";
import { parsePatch } from "../diff";

interface Props {
  patch: string;
  emptyMessage?: string;
}

export default function DiffView({ patch, emptyMessage }: Props) {
  const files = useMemo(() => parsePatch(patch), [patch]);

  if (!patch.trim() || files.length === 0) {
    return <div className="diff-empty">{emptyMessage ?? "No changes to show"}</div>;
  }

  return (
    <div className="diff-view">
      {files.map((file, i) => (
        <div className="diff-file" key={`${file.newPath}-${i}`}>
          <div className="diff-file-header">
            <span className="diff-file-name">
              {file.isRename ? `${file.oldPath} → ${file.newPath}` : file.newPath}
            </span>
            {file.isNew && <span className="badge badge-add">new</span>}
            {file.isDeleted && <span className="badge badge-del">deleted</span>}
            <span className="diff-stats">
              <span className="stat-add">+{file.additions}</span>{" "}
              <span className="stat-del">−{file.deletions}</span>
            </span>
          </div>
          {file.isBinary ? (
            <div className="diff-binary">Binary file</div>
          ) : (
            <table className="diff-table">
              <tbody>
                {file.lines.map((line, j) =>
                  line.kind === "hunk" ? (
                    <tr className="diff-line diff-hunk" key={j}>
                      <td className="line-no" />
                      <td className="line-no" />
                      <td className="line-text">{line.text}</td>
                    </tr>
                  ) : (
                    <tr className={`diff-line diff-${line.kind}`} key={j}>
                      <td className="line-no">{line.oldNo ?? ""}</td>
                      <td className="line-no">{line.newNo ?? ""}</td>
                      <td className="line-text">
                        <span className="line-sign">
                          {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
                        </span>
                        {line.text}
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}
