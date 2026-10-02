// STUB — replaced by the feature builder. Tab root for "Clients".
import PageHeader from '../../components/ui/PageHeader';
import { EmptyState } from '../../components/ui/kit';

export default function Page() {
  return (
    <div className="km-screen">
      <PageHeader title="Clients" large />
      <div className="km-screen-body km-scroll">
        <EmptyState icon="users" title="Clients" sub="This surface is being built." />
      </div>
    </div>
  );
}
