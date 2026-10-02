// STUB — replaced by the feature builder. Tab root for "Phone".
import PageHeader from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/kit';

export default function Page() {
  return (
    <div className="km-screen">
      <PageHeader title="Phone" large />
      <div className="km-screen-body km-scroll">
        <EmptyState icon="phone" title="Phone" sub="This surface is being built." />
      </div>
    </div>
  );
}
