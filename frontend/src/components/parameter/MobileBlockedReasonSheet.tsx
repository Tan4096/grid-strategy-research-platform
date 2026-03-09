import MobileSheet from "../ui/MobileSheet";

interface Props {
  open: boolean;
  reason: string | null;
  onClose: () => void;
}

export default function MobileBlockedReasonSheet({ open, reason, onClose }: Props) {
  return (
    <MobileSheet open={open} title="当前仍无法开始" onClose={onClose} dataTourId="mobile-blocked-reason-sheet">
      <div className="card-sub border border-rose-400/35 bg-rose-500/10 p-3 text-sm text-rose-100">
        {reason ?? "仍有参数未完成，请返回上一步检查。"}
      </div>
    </MobileSheet>
  );
}
