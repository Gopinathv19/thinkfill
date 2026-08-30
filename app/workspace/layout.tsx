import { FormProvider } from "@/context/FormContext";

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <FormProvider>{children}</FormProvider>;
}
