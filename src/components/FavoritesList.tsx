import { samePath } from "../folders";
import { basename, dirname } from "../paths";
import { t } from "../i18n";

interface Props {
  favorites: string[];
  root: string | null;
  onOpen: (path: string) => void;
  onRemove: (path: string) => void;
}

/** Избранные папки над деревом: клик открывает папку как рабочую. */
export function FavoritesList({ favorites, root, onOpen, onRemove }: Props) {
  const names = favorites.map((p) => basename(p) || p);

  return (
    <div className="favorites">
      <div className="section-title">{t("favorites.title")}</div>
      {favorites.length === 0 ? (
        <p className="favorites-empty">{t("favorites.empty")}</p>
      ) : (
        <ul className="tree">
          {favorites.map((path, i) => {
            // Две папки с одинаковым именем различаем по родительской.
            const duplicate = names.indexOf(names[i]) !== names.lastIndexOf(names[i]);
            return (
              <li key={path} className={"folder-row" + (root && samePath(root, path) ? " active" : "")}>
                <button className="folder-open" onClick={() => onOpen(path)} title={path}>
                  <span className="folder-name">★ {names[i]}</span>
                  {duplicate && <span className="folder-parent">{basename(dirname(path))}</span>}
                </button>
                <button className="folder-remove" onClick={() => onRemove(path)} title={t("favorites.remove")}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
