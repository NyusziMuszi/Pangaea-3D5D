import type { ReactNode } from "react";

// Shared backdrop + .modal shell for the Export/Preferences/Shader-editor
// dialogs, which otherwise all repeat the same backdrop-click-to-close and
// stopPropagation wiring. head/foot are optional since the shader editor puts
// its "Done" action in the head row and has no foot.
export function Modal({
  onClose,
  modalClassName,
  footClassName,
  head,
  foot,
  children,
}: {
  onClose: () => void;
  modalClassName?: string;
  footClassName?: string;
  head?: ReactNode;
  foot?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={`modal${modalClassName ? ` ${modalClassName}` : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {head && <div className="modal-head">{head}</div>}
        {children}
        {foot && (
          <div
            className={`modal-foot${footClassName ? ` ${footClassName}` : ""}`}
          >
            {foot}
          </div>
        )}
      </div>
    </div>
  );
}
