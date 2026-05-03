using System.Threading.Tasks;

public class TaskWaitBlockingService
{
    public void Run(Task task)
    {
        task.Wait();
    }
}