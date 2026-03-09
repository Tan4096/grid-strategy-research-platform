import { ReactNode } from "react";
import MobileSheet from "../ui/MobileSheet";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export default function MobileTemplateSheet({
  open,
  title,
  onClose,
  children
}: Props) {
  return (
    <MobileSheet open={open} title={title} onClose={onClose} dataTourId="mobile-template-sheet">
      <div className="space-y-3">{children}</div>
    </MobileSheet>
  );
}
