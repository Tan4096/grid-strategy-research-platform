import { ReactNode } from "react";
import MobileSheet from "../../ui/MobileSheet";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export default function MobileResultsTableSheet({ open, onClose, children }: Props) {
  return (
    <MobileSheet
      open={open}
      title="全部结果"
      onClose={onClose}
      dataTourId="mobile-results-table-sheet"
    >
      {children}
    </MobileSheet>
  );
}
