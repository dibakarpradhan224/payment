'use client';
import { useParams } from 'next/navigation';
import { useApi } from '@/lib/hooks';
import { W } from '@/lib/api';
import { PayRequest } from '@/components/PayRequest';
import { ErrorBox, PageTitle, Skeleton } from '@/components/ui';

export default function PayLink() {
  const { requestId } = useParams<{ requestId: string }>();
  const r = useApi<any>(`${W}/pay/request/${requestId}`);
  return <div className="mx-auto max-w-md"><PageTitle>Pay</PageTitle>{r.loading ? <Skeleton className="h-64" /> : r.error ? <ErrorBox message={r.error.message} /> : <PayRequest request={r.data.request} />}</div>;
}
