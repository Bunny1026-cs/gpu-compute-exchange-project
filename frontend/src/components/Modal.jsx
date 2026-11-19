import { useEffect, useRef } from "react";

export default function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog className="modal" ref={ref} aria-labelledby="modal-title"
    onCancel={onClose} onClick={event => {
      if (event.target !== ref.current) return;
      const box = ref.current.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right ||
          event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <div className="modal-header"><h3 id="modal-title">{title}</h3>
      <button type="button" className="btn-clear" aria-label="Close settings" onClick={onClose}>×</button>
    </div>{children}
  </dialog>;
}
