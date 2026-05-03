using System.Threading.Tasks;

public class TaskResultBlockingService
{
    public int Run(Task<int> task)
    {
        return task.Result;
    }
}